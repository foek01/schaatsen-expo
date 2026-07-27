# Schaatssprint 500m — Expo + server

Expo-app (WebView) + Node/WebSocket-server. Alle game-opties uit de webversie: profiel, pak-editor, solo vs AI, multiplayer lobby, ritme/energie/wissel.

```
schaatsen-expo/
  app/       # Expo (iOS / Android / web)
  server/    # Node HTTP + WebSocket lobby
```

## Boarding-ads admin

Open in de browser: `http://jouw-server/admin`

Standaard wachtwoord: `schaatsadmin`  
Zet op de VPS een eigen wachtwoord:

```bash
ADMIN_PASSWORD='jouw-sterke-wachtwoord' pm2 restart schaats-expo --update-env
# of in Coolify/Docker: env ADMIN_PASSWORD=...
```

Ads worden opgeslagen in `server/data/ads.json`. Afbeeldingen in `server/public/ads/`.

**Image-formaat:** PNG, JPG of WebP · max 3 MB · ideaal **1360×224** of **680×112** px (breed × laag).

## Lokaal draaien

### 1. Server

```bash
cd server
npm install
npm start                 # http://localhost:8080
# of: PORT=3000 npm start
```

Open in de browser: http://localhost:8080 — daar moet de game laden.

### 2. Expo-app

```bash
cd app
cp .env.example .env      # pas GAME_URL aan indien nodig
npm install
npx expo start
```

Zet in `app/.env`:

```
EXPO_PUBLIC_GAME_URL=http://localhost:8080
```

- **iOS Simulator:** `localhost` werkt.
- **Fysieke telefoon:** gebruik het LAN-IP van je Mac, bijv. `http://192.168.1.20:8080` (zelfde wifi).
- **Android emulator:** `http://10.0.2.2:8080`.

De app lockt landscape en laadt de game in een WebView. Multiplayer praat via WebSocket op dezelfde host.

## VPS deploy (eigen server)

Deploy alleen de map `server/` (of de hele repo, werkdirectory `server`).

### Optie A — pm2 + nginx

```bash
git clone https://github.com/foek01/schaatsen-expo.git
cd schaatsen-expo/server
npm install --omit=dev

npm i -g pm2
PORT=8080 pm2 start server.js --name schaats-expo
pm2 save && pm2 startup
```

Nginx (WebSocket-upgrade is verplicht):

```nginx
server {
  server_name schaats.jouwdomein.nl;

  location / {
    proxy_pass         http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;
  }
}
```

Daarna `certbot --nginx -d schaats.jouwdomein.nl`.

### Optie B — Docker / Coolify

Er staat een `server/Dockerfile`. Wijs Coolify naar de `server/` map, poort **8080**, HTTP. Zorg dat WebSockets niet worden uitgezet in de proxy.

### Expo naar productie wijzen

In `app/.env` (of EAS secrets):

```
EXPO_PUBLIC_GAME_URL=https://schaats.jouwdomein.nl
```

Of je sslip.io-URL, bijv.:

```
EXPO_PUBLIC_GAME_URL=http://jouw-app.149.210.237.185.sslip.io
```

Herstart Expo / maak een nieuwe build zodat de env-var meekomt.

## WebSocket-config in de game

De client verbindt standaard met `location.host`. Optioneel:

- Query: `?ws=host:poort` of `?ws=wss://host`
- Of `window.__WS_URL__` (de Expo-app injecteert dit automatisch vanuit `GAME_URL`)

## Scripts (root)

```bash
npm run install:all
npm run server
npm run app
```

## Wat zit erin

- Naam + profiel (localStorage in WebView)
- Pak-kleuren + man/vrouw
- Tegen de computer (AI-niveau)
- Multiplayer lobby (uitdagen / accepteren / gedeeld aftellen)
- 500m baan, ritmebalken, energie, baanwissel
- Resultaten + PR

## App Store / Play Store

Nog niet geconfigureerd voor store-submission. Later: `eas build` met dezelfde `EXPO_PUBLIC_GAME_URL`.
