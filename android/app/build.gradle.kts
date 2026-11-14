plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Byggenummeret fra GitHub Actions bliver versionsnummeret, så nye APK'er kan
// installeres oven på de gamle.
val build = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "dk.dagbog.billeder"
    compileSdk = 35

    defaultConfig {
        applicationId = "dk.dagbog.billeder"
        minSdk = 34
        targetSdk = 35
        versionCode = build
        versionName = "1.0.$build"
    }

    // Fast nøgle i repoet, så opdateringer kan installeres oven på den gamle version.
    signingConfigs {
        getByName("debug") {
            storeFile = file("billeder-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
