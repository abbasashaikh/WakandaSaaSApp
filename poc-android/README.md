# AI Creative Studio — Android App

## Setup (one-time)

### 1. Install React Native development environment
Follow the official guide for React Native CLI (not Expo):
https://reactnative.dev/docs/environment-setup

Required:
- Node.js 18+ (you already have this)
- Java JDK 17
- Android Studio + Android SDK
- Android emulator OR physical device with USB debugging enabled

### 2. Install dependencies
```bash
cd poc-android
npm install
```

### 3. Run on Android emulator or device
```bash
npx react-native run-android
```

### 4. First launch on the device
The app opens to a **Server Setup** screen asking for the backend URL.
Enter your ngrok URL (e.g. `https://phrasing-collie-overpass.ngrok-free.app`)
and tap Connect.

After that, enter the license key: `poc-test-key-12345678`

---

## How platform detection works

Every API request from the Android app includes this header:
```
X-Platform: android
```

The Windows Electron app sends:
```
X-Platform: windows
```

The backend logs and stores this on every request and every job:
```json
{
  "status": 200,
  "platform": "android",
  "userId": 1,
  "ms": 23
}
```

You can query which platform generated which jobs:
```sql
SELECT platform, COUNT(*) as jobs FROM poc_jobs GROUP BY platform;
-- Result:
-- windows | 42
-- android | 7
```

---

## Key differences from the Windows app

| Feature | Windows (Electron) | Android (React Native) |
|---|---|---|
| Server URL | Baked in at build time | Configurable at runtime in Settings |
| Token storage | Electron IPC (main process) | AsyncStorage (encrypted on Android 6+) |
| Platform header | `x-platform: windows` | `x-platform: android` |
| Video player | HTML `<video>` tag | `react-native-video` |
| Image display | HTML `<img>` tag | React Native `<Image>` |
| First screen | Login | Server Setup → Login |

---

## Building a release APK

```bash
cd poc-android/android
./gradlew assembleRelease
```

APK location: `android/app/build/outputs/apk/release/app-release.apk`

Send this file to testers. They install it by opening the APK on their Android device
(Android will ask to enable "Install from unknown sources" — this is normal for sideloading).
