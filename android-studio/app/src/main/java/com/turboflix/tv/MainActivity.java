package com.turboflix.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.content.Context;
import android.os.SystemClock;
import android.webkit.WebResourceRequest;
import android.widget.Toast;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private WebView webView;
    private volatile boolean destroyed;
    private boolean resumed;
    private final ThreadPoolExecutor dlnaExecutor = new ThreadPoolExecutor(1, 1,
            0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(4));

    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);

        getWindow().setBackgroundDrawableResource(android.R.color.black);
        hideSystemUI();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0B0616"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0B0616"));
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setLoadsImagesAutomatically(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " TurboFlix/1.8.5");

        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new DlnaBridge(), "AndroidDlna");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest request) {
                try {
                    Uri uri = request.getUrl();
                    if (uri != null && "file".equals(uri.getScheme())) {
                        String path = uri.getPath();
                        if (path != null && path.startsWith("/android_asset/www/") && !path.contains("..")) {
                            String assetPath = path.substring("/android_asset/".length());
                            String mime = guessMime(assetPath);
                            InputStream is = getAssets().open(assetPath);
                            return new android.webkit.WebResourceResponse(mime, "UTF-8", is);
                        }
                    }
                } catch (Exception ignored) {
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                // Mantém o WebView sempre visível (View.VISIBLE) para não pausar o decodificador de vídeo na Fire TV!
                if (callback != null) callback.onCustomViewHidden();
                hideSystemUI();
            }

            @Override
            public void onHideCustomView() {
                hideSystemUI();
            }
        });

        webView.loadUrl("file:///android_asset/www/index.html");
        webView.requestFocus();
    }

    /** Ponte Java nativa para descoberta SSDP e controle DLNA UPnP AVTransport + Player Externo */
    public class DlnaBridge {

        @JavascriptInterface
        public void request(String id, String action, String payload) {
            if (destroyed || id == null || id.length() > 80) return;
            long deadline = SystemClock.elapsedRealtime() + 20000;
            try {
                dlnaExecutor.execute(() -> {
                    if (destroyed || SystemClock.elapsedRealtime() >= deadline) {
                        deliverNativeResult(id, "Operação expirada. Tente novamente.", true);
                        return;
                    }
                    try {
                        JSONObject args = new JSONObject(payload);
                        String result;
                        switch (action) {
                            case "discover": result = discoverDevices(); break;
                            case "cast": result = castToDevice(args.optString("host"), args.optString("url"),
                                    args.optString("title"), args.optBoolean("live")); break;
                            case "stop": stopDevice(args.optString("host")); result = "ok"; break;
                            default: throw new IllegalArgumentException("Ação desconhecida");
                        }
                        deliverNativeResult(id, result, false);
                    } catch (Exception e) {
                        deliverNativeResult(id, "Não foi possível concluir a operação DLNA.", true);
                    }
                });
            } catch (RejectedExecutionException e) {
                deliverNativeResult(id, "Aguarde a operação DLNA em andamento.", true);
            }
        }

        @JavascriptInterface
        public void setPlaybackState(boolean playing) {
            runOnUiThread(() -> {
                if (destroyed) return;
                if (playing && resumed) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        private String discoverDevices() {
            JSONArray out = new JSONArray();
            Set<String> locations = new LinkedHashSet<>();
            DatagramSocket socket = null;
            WifiManager.MulticastLock multicastLock = null;
            long deadline = SystemClock.elapsedRealtime() + 8000;
            try {
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) {
                    multicastLock = wifi.createMulticastLock("turboflix-discovery");
                    multicastLock.setReferenceCounted(false);
                    multicastLock.acquire();
                }
                socket = new DatagramSocket();
                socket.setSoTimeout(400);
                InetAddress group = InetAddress.getByName("239.255.255.250");
                String[] targets = new String[]{
                        "urn:schemas-upnp-org:service:AVTransport:1",
                        "urn:schemas-upnp-org:device:MediaRenderer:1"
                };
                for (String st : targets) {
                    String msg = "M-SEARCH * HTTP/1.1\r\n" +
                            "HOST: 239.255.255.250:1900\r\n" +
                            "MAN: \"ssdp:discover\"\r\n" +
                            "MX: 1\r\n" +
                            "ST: " + st + "\r\n\r\n";
                    byte[] data = msg.getBytes(StandardCharsets.UTF_8);
                    socket.send(new DatagramPacket(data, data.length, group, 1900));
                }
                long end = SystemClock.elapsedRealtime() + 1400;
                byte[] buf = new byte[4096];
                Pattern locPat = Pattern.compile("(?im)^LOCATION:\\s*(https?://[^\\r\\n]+)");
                while (!destroyed && SystemClock.elapsedRealtime() < end && locations.size() < 12) {
                    try {
                        DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                        socket.receive(pkt);
                        String resp = new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8);
                        Matcher m = locPat.matcher(resp);
                        if (m.find()) {
                            locations.add(m.group(1).trim());
                        }
                    } catch (SocketTimeoutException ignored) {
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (socket != null) socket.close();
                if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
            }

            for (String loc : locations) {
                if (destroyed || SystemClock.elapsedRealtime() >= deadline) break;
                try {
                    JSONObject dev = parseDeviceDescription(loc);
                    if (dev != null) out.put(dev);
                } catch (Exception ignored) {
                }
            }
            return out.toString();
        }

        private JSONObject parseDeviceDescription(String locUrl) throws Exception {
            URL u = new URL(locUrl);
            HttpURLConnection conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(1500);
            conn.setReadTimeout(1500);
            try (InputStream is = conn.getInputStream()) {
                String xml = readStream(is);
                if (!xml.contains("AVTransport") && !xml.contains("MediaRenderer")) return null;
                String name = extractTag(xml, "friendlyName");
                if (name == null || name.isEmpty()) name = u.getHost();
                String controlUrl = extractAvTransportControlUrl(xml, u);
                if (controlUrl == null) return null;
                JSONObject obj = new JSONObject();
                obj.put("name", name);
                obj.put("host", u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : ""));
                obj.put("location", locUrl);
                obj.put("controlUrl", controlUrl);
                return obj;
            } finally {
                conn.disconnect();
            }
        }

        private String extractTag(String xml, String tag) {
            Matcher m = Pattern.compile("(?is)<" + tag + "[^>]*>(.*?)</" + tag + ">").matcher(xml);
            return m.find() ? m.group(1).trim() : null;
        }

        private String extractAvTransportControlUrl(String xml, URL baseUrl) throws Exception {
            Matcher sm = Pattern.compile("(?is)<service>(.*?)</service>").matcher(xml);
            while (sm.find()) {
                String block = sm.group(1);
                if (block.contains("AVTransport")) {
                    String ctrl = extractTag(block, "controlURL");
                    if (ctrl != null && !ctrl.isEmpty()) {
                        return new URL(baseUrl, ctrl).toString();
                    }
                }
            }
            return null;
        }

        private String castToDevice(String hostOrUrl, String streamUrl, String title, boolean isLive) {
            try {
                String[] candidates = resolveCandidates(hostOrUrl);
                String safeTitle = escapeXml(title != null ? title : "TurboFlix");
                String safeUrl = escapeXml(streamUrl);
                String lower = streamUrl.toLowerCase(Locale.ROOT);
                String mime = lower.contains(".m3u8") ? "application/x-mpegURL"
                        : lower.contains(".ts") ? "video/mp2t"
                        : lower.contains(".mkv") ? "video/x-matroska" : "video/mp4";
                String upnpClass = isLive ? "object.item.videoItem.videoBroadcast" : "object.item.videoItem.movie";
                String flags = isLive ? "DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=8D700000000000000000000000000000"
                        : "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";
                String didl = "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\"><item id=\"0\" parentID=\"-1\" restricted=\"1\"><dc:title>"
                        + safeTitle + "</dc:title><upnp:class>" + upnpClass + "</upnp:class><res protocolInfo=\"http-get:*:"
                        + mime + ":" + flags + "\">" + safeUrl + "</res></item></DIDL-Lite>";
                String setBody = "<InstanceID>0</InstanceID><CurrentURI>" + safeUrl
                        + "</CurrentURI><CurrentURIMetaData>" + escapeXml(didl) + "</CurrentURIMetaData>";
                String playBody = "<InstanceID>0</InstanceID><Speed>1</Speed>";

                long deadline = SystemClock.elapsedRealtime() + 15000;
                for (String ep : candidates) {
                    if (destroyed || SystemClock.elapsedRealtime() >= deadline) break;
                    if (sendSoap(ep, "SetAVTransportURI", setBody)) {
                        if (!sendSoap(ep, "Play", playBody)) return "A TV recebeu o vídeo, mas não confirmou a reprodução.";
                        return "✔ Transmitindo na TV DLNA (" + ep + ")!";
                    }
                }
                return "⚠️ Não foi possível conectar ao receptor DLNA em " + hostOrUrl + ". Verifique se a TV está na mesma rede Wi-Fi.";
            } catch (Exception e) {
                return "Erro DLNA: " + e.getMessage();
            }
        }

        private void stopDevice(String hostOrUrl) {
            try {
                long deadline = SystemClock.elapsedRealtime() + 8000;
                for (String ep : resolveCandidates(hostOrUrl)) {
                    if (destroyed || SystemClock.elapsedRealtime() >= deadline) break;
                    if (sendSoap(ep, "Stop", "<InstanceID>0</InstanceID>")) break;
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void openExternalPlayer(String streamUrl, String title) {
            if (streamUrl == null || !(streamUrl.startsWith("http://") || streamUrl.startsWith("https://"))) return;
            runOnUiThread(() -> {
                if (destroyed) return;
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(Uri.parse(streamUrl), "video/*");
                    if (title != null) intent.putExtra("title", title);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(Intent.createChooser(intent, "Transmitir / Abrir vídeo com:"));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "Nenhum player externo disponível.", Toast.LENGTH_LONG).show();
                }
            });
        }

        private String[] resolveCandidates(String raw) {
            raw = raw != null ? raw.trim() : "";
            if (raw.startsWith("http://") || raw.startsWith("https://")) {
                return new String[]{raw};
            }
            String ip = raw.split(":")[0];
            if (raw.contains(":")) {
                return new String[]{
                        "http://" + raw + "/upnp/control/AVTransport1",
                        "http://" + raw + "/MediaRenderer/AVTransport/Control",
                        "http://" + raw + "/upnp/control/rendertransport1",
                        "http://" + raw + "/AVTransport/ctrl",
                        "http://" + raw + "/ctl/AVT",
                        "http://" + raw + "/smp_22_"
                };
            }
            return new String[]{
                    "http://" + ip + ":9197/upnp/control/AVTransport1",
                    "http://" + ip + ":7676/smp_22_",
                    "http://" + ip + ":49152/upnp/control/AVTransport1",
                    "http://" + ip + ":49152/upnp/control/rendertransport1",
                    "http://" + ip + ":49152/AVTransport/ctrl",
                    "http://" + ip + ":49153/upnp/control/AVTransport1",
                    "http://" + ip + ":1400/MediaRenderer/AVTransport/Control",
                    "http://" + ip + ":52235/upnp/control/AVTransport1",
                    "http://" + ip + ":8200/ctl/AVT",
                    "http://" + ip + ":1421/upnp/control/AVTransport1"
            };
        }

        private boolean sendSoap(String controlUrl, String action, String innerXml) {
            HttpURLConnection conn = null;
            try {
                String env = "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                        "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
                        "<s:Body><u:" + action + " xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">" +
                        innerXml + "</u:" + action + "></s:Body></s:Envelope>";
                byte[] bytes = env.getBytes(StandardCharsets.UTF_8);
                conn = (HttpURLConnection) new URL(controlUrl).openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(1500);
                conn.setReadTimeout(2000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
                conn.setRequestProperty("SOAPAction", "\"urn:schemas-upnp-org:service:AVTransport:1#" + action + "\"");
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bytes);
                }
                int code = conn.getResponseCode();
                return code >= 200 && code < 300;
            } catch (Exception e) {
                return false;
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        private String escapeXml(String s) {
            if (s == null) return "";
            return s.replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                    .replace("\"", "&quot;")
                    .replace("'", "&apos;");
        }

        private String readStream(InputStream is) throws Exception {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] b = new byte[2048];
            int n;
            long deadline = SystemClock.elapsedRealtime() + 8000;
            while ((n = is.read(b)) != -1) {
                if (destroyed || SystemClock.elapsedRealtime() >= deadline || bos.size() + n > 512 * 1024) throw new java.io.IOException("Descrição DLNA muito grande");
                bos.write(b, 0, n);
            }
            return bos.toString("UTF-8");
        }
    }

    private void deliverNativeResult(String id, String value, boolean error) {
        runOnUiThread(() -> {
            if (destroyed || webView == null) return;
            try {
                JSONObject detail = new JSONObject();
                detail.put("id", id); detail.put("value", value); detail.put("error", error);
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('turboflix:native-result',{detail:"
                        + detail.toString() + "}))", null);
            } catch (Exception ignored) { }
        });
    }

    private boolean handleNavigation(Uri uri) {
        if ("file".equals(uri.getScheme()) && "/android_asset/www/index.html".equals(uri.getPath())) return false;
        // Only the bundled app may access the native bridge. Open external pages outside it.
        if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
            catch (Exception e) { Toast.makeText(this, "Nenhum navegador disponível.", Toast.LENGTH_SHORT).show(); }
        }
        return true;
    }

    private String guessMime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        return "application/octet-stream";
    }

    private void hideSystemUI() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUI();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) {
                handleBack();
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(
                "(function(){ " +
                        "var cm = document.getElementById('p-cast-modal'); " +
                        "if(cm && !cm.hidden){ cm.hidden = true; cm.innerHTML = ''; return 'handled'; } " +
                        "var h = location.hash || ''; " +
                        "if(h && h !== '#/home' && h !== '#/login' && h !== '#/'){ history.back(); return 'handled'; } " +
                        "return 'root'; })()",
                value -> {
                    if (!destroyed && value != null && value.contains("root")) {
                        moveTaskToBack(true);
                    }
                });
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('turboflix:pause'))", null);
            webView.onPause();
        }
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.dispatchEvent(new Event('turboflix:resume'))", null);
        }
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        dlnaExecutor.shutdownNow();
        if (webView != null) {
            webView.stopLoading();
            webView.removeJavascriptInterface("AndroidDlna");
            if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
