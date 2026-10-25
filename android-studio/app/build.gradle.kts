plugins {
    id("com.android.application")
}

android {
    namespace = "com.turboflix.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.turboflix.tv"
        minSdk = 22          // Requer também WebView e codecs compatíveis com os recursos do app
        targetSdk = 35
        versionCode = 2
        versionName = "1.8.5"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Assine a versão de distribuição pelo assistente do Android Studio.
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Zero dependências externas: usa Android SDK puro + WebView nativo acelerado por hardware
}
