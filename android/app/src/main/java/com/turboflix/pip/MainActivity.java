package com.turboflix.pip;

import android.annotation.SuppressLint;
import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.*;
import android.util.Rational;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.lang.ref.WeakReference;
import java.util.Collections;

/** TurboFlix 1.8.7: player web e Picture-in-Picture nativo Android 8+. */
public class MainActivity extends Activity {
  private static final String URL = "https://jamesnegrini89-ops.github.io/Turboflix/?apk=1.8.7";
  private static final String HOST = "jamesnegrini89-ops.github.io";
  private static WeakReference<MainActivity> current = new WeakReference<>(null);
  private FrameLayout root;
  private WebView web;
  private View fullView;
  private WebChromeClient.CustomViewCallback fullCallback;
  private boolean playing = false, hasVideo = false;
  private int width = 16, height = 9;

  private static final String HOOK = """
    (() => {
      if (window.__tfNativeReady) return;
      const v = document.getElementById('video');
      if (!v || !window.NativePip) return;
      window.__tfNativeReady = true;
      const report = () => {
        try {
          NativePip.state(!v.paused && !v.ended && v.readyState >= 2,
                          v.videoWidth || 0, v.videoHeight || 0);
        } catch (_) {}
      };
      ['play','playing','pause','ended','loadedmetadata','canplay','emptied','error','waiting']
        .forEach(e => v.addEventListener(e, report));
      setInterval(report, 1500);
      const style = document.createElement('style');
      style.textContent =
        'html.tf-native-pip #topbar,html.tf-native-pip #view,' +
        'html.tf-native-pip #player .p-overlay,html.tf-native-pip #player .p-spinner,' +
        'html.tf-native-pip #player .p-error,html.tf-native-pip #player .p-cast-modal,' +
        'html.tf-native-pip #player .p-zap,html.tf-native-pip #p-start {display:none!important}' +
        'html.tf-native-pip #player{display:block!important;position:fixed!important;inset:0!important;' +
        'width:100vw!important;height:100vh!important;z-index:99999!important}' +
        'html.tf-native-pip #video{position:absolute!important;inset:0!important;' +
        'width:100%!important;height:100%!important;object-fit:contain!important}';
      document.head.appendChild(style);
      const top = document.querySelector('#player .p-top');
      if (top && !document.getElementById('native-pip')) {
        const button = document.createElement('button');
        button.id='native-pip';button.type='button';button.className='p-btn focusable';
        button.textContent='▣';button.title='Tela flutuante Android';
        button.setAttribute('aria-label',button.title);
        button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();NativePip.enter();});
        const target=top.querySelector('[data-p="cast"]');
        if(target)top.insertBefore(button,target);else top.appendChild(button);
      }
      report();
    })();
    """;

  @SuppressLint({"SetJavaScriptEnabled","AddJavascriptInterface"})
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    current = new WeakReference<>(this);
    getWindow().setStatusBarColor(Color.BLACK);
    getWindow().setNavigationBarColor(Color.BLACK);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    root = new FrameLayout(this);
    web = new WebView(this);
    web.setBackgroundColor(Color.BLACK);
    root.addView(web,new FrameLayout.LayoutParams(-1,-1));
    setContentView(root);

    WebSettings s=web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setAllowFileAccessFromFileURLs(false);
    s.setAllowUniversalAccessFromFileURLs(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    CookieManager.getInstance().setAcceptCookie(true);
    web.addJavascriptInterface(new Bridge(),"NativePip");
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req){
        Uri u=req.getUrl();
        if("https".equalsIgnoreCase(u.getScheme())&&HOST.equalsIgnoreCase(u.getHost())&&
            u.getPath()!=null&&u.getPath().startsWith("/Turboflix/"))return false;
        if(req.isForMainFrame()){
          try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception ignored){}
        }
        return true;
      }
      @Override public void onPageFinished(WebView view,String url){
        if(url!=null&&url.startsWith("https://"+HOST+"/Turboflix/"))view.evaluateJavascript(HOOK,null);
      }
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public void onShowCustomView(View v,CustomViewCallback cb){
        if(fullView!=null){cb.onCustomViewHidden();return;}
        fullView=v;fullCallback=cb;web.setVisibility(View.GONE);
        root.addView(v,new FrameLayout.LayoutParams(-1,-1));
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
      }
      @Override public void onHideCustomView(){closeFullscreen();}
    });
    if(state==null)web.loadUrl(URL);else web.restoreState(state);
    updatePip();
  }

  public final class Bridge {
    @JavascriptInterface public void state(boolean isPlaying,int w,int h){
      runOnUiThread(()->{
        if(web==null)return;
        boolean valid=w>0&&h>0;
        if(isPlaying==playing&&valid==hasVideo&&(!valid||(w==width&&h==height)))return;
        playing=isPlaying;hasVideo=valid;
        if(valid){width=w;height=h;}
        updatePip();
      });
    }
    @JavascriptInterface public void enter(){runOnUiThread(()->enterPip());}
  }

  private RemoteAction action(){
    boolean pause=playing;
    String cmd=pause?"com.turboflix.pip.PAUSE":"com.turboflix.pip.PLAY";
    Intent intent=new Intent(this,PipReceiver.class).setAction(cmd);
    PendingIntent pending=PendingIntent.getBroadcast(this,pause?1:2,intent,
      PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    String label=pause?"Pausar":"Reproduzir";
    return new RemoteAction(Icon.createWithResource(this,
      pause?android.R.drawable.ic_media_pause:android.R.drawable.ic_media_play),label,label,pending);
  }

  private void updatePip(){
    if(Build.VERSION.SDK_INT<26||!getPackageManager()
        .hasSystemFeature("android.software.picture_in_picture"))return;
    float ratio=Math.min(2.39f,Math.max(1f/2.39f,(float)width/Math.max(1,height)));
    PictureInPictureParams.Builder b=new PictureInPictureParams.Builder()
        .setAspectRatio(new Rational(Math.round(ratio*1000),1000))
        .setActions(Collections.singletonList(action()));
    if(Build.VERSION.SDK_INT>=31)b.setAutoEnterEnabled(playing);
    try{setPictureInPictureParams(b.build());}catch(Exception ignored){}
  }

  private void enterPip(){
    if(Build.VERSION.SDK_INT<26||!(playing||hasVideo)){
      Toast.makeText(this,"Inicie um vídeo antes de ativar a tela flutuante.",Toast.LENGTH_SHORT).show();
      return;
    }
    try{
      if(!isInPictureInPictureMode()){
        updatePip();
        enterPictureInPictureMode(new PictureInPictureParams.Builder()
          .setAspectRatio(new Rational(16,9))
          .setActions(Collections.singletonList(action())).build());
      }
    }catch(Exception e){
      Toast.makeText(this,"Picture-in-Picture indisponível neste aparelho.",Toast.LENGTH_SHORT).show();
    }
  }

  public static class PipReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
      MainActivity a=current.get();
      if(a==null||a.web==null)return;
      String method="com.turboflix.pip.PAUSE".equals(intent.getAction())?
        "v.pause();":"v.play().catch(()=>{});";
      a.runOnUiThread(()->a.web.evaluateJavascript(
        "(()=>{const v=document.getElementById('video');if(v){"+method+"}})()",null));
    }
  }

  @Override protected void onUserLeaveHint(){
    super.onUserLeaveHint();
    if(Build.VERSION.SDK_INT>=26&&Build.VERSION.SDK_INT<31&&playing)enterPip();
  }

  @Override public void onPictureInPictureModeChanged(boolean active,Configuration cfg){
    super.onPictureInPictureModeChanged(active,cfg);
    if(web!=null)web.evaluateJavascript(
      "document.documentElement.classList.toggle('tf-native-pip',"+active+")",null);
  }

  private void closeFullscreen(){
    if(fullView==null)return;
    root.removeView(fullView);fullView=null;web.setVisibility(View.VISIBLE);
    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    if(fullCallback!=null)fullCallback.onCustomViewHidden();
    fullCallback=null;
  }

  @Override public void onBackPressed(){
    if(fullView!=null){closeFullscreen();return;}
    if(web!=null&&web.canGoBack()){web.goBack();return;}
    super.onBackPressed();
  }
  @Override protected void onSaveInstanceState(Bundle state){
    if(web!=null)web.saveState(state);
    super.onSaveInstanceState(state);
  }
  @Override protected void onDestroy(){
    current.clear();
    if(web!=null){root.removeView(web);web.destroy();web=null;}
    super.onDestroy();
  }
}
