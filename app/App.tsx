import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { WebView } from 'react-native-webview';

/** Publieke game-URL op je VPS, of lokaal http://localhost:8080 */
const GAME_URL =
  process.env.EXPO_PUBLIC_GAME_URL?.replace(/\/$/, '') ||
  'http://localhost:8080';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.LANDSCAPE,
        );
      } catch {
        // web / simulator zonder orientation API
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  const injected = useMemo(() => {
    try {
      const u = new URL(GAME_URL);
      return `window.__WS_URL__=${JSON.stringify(u.host)};true;`;
    } catch {
      return 'true;';
    }
  }, []);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color="#4fd0ff" size="large" />
        <StatusBar hidden />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <WebView
        source={{ uri: GAME_URL }}
        style={styles.webview}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        originWhitelist={['*']}
        allowsBackForwardNavigationGestures={false}
        injectedJavaScriptBeforeContentLoaded={injected}
        onError={() =>
          setError('Kan de baan niet laden. Check EXPO_PUBLIC_GAME_URL / server.')
        }
        onHttpError={() =>
          setError('Server gaf een fout. Is de Schaatssprint-server online?')
        }
        startInLoadingState
        renderLoading={() => (
          <View style={styles.boot}>
            <ActivityIndicator color="#4fd0ff" size="large" />
            <Text style={styles.hint}>Baan laden…</Text>
          </View>
        )}
      />
      {error ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.hint}>{GAME_URL}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1016',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0b1016',
  },
  boot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b1016',
    gap: 12,
  },
  hint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '600',
  },
  error: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,13,20,0.92)',
    padding: 24,
    gap: 8,
  },
  errorText: {
    color: '#ff9a8a',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
});
