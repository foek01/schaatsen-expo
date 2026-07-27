#!/bin/bash
# Lokale iOS App Store build + submit naar Apple
set -euo pipefail
cd "$(dirname "$0")"

export EXPO_APPLE_ID="${EXPO_APPLE_ID:-erwin36@hotmail.com}"
export EXPO_APPLE_TEAM_ID="${EXPO_APPLE_TEAM_ID:-SY95HT6G44}"
export EAS_BUILD_NO_EXPO_GO_WARNING=true

echo "==> Schaatssprint iOS local build"
echo "    Apple ID: $EXPO_APPLE_ID"
echo "    Team:     $EXPO_APPLE_TEAM_ID"
echo "    Game URL: http://psvq84rzruy39duxozydb9rp.149.210.237.185.sslip.io"
echo ""
echo "Je moet mogelijk inloggen bij Apple (wachtwoord + 2FA)."
echo ""

# 1) Credentials / Distribution cert (interactief eerste keer)
eas credentials -p ios || true

# 2) Local production build → .ipa
eas build -p ios --profile production --local

# 3) Zoek nieuwste ipa
IPA=$(ls -t ./*.ipa 2>/dev/null | head -1 || true)
if [[ -z "${IPA}" ]]; then
  IPA=$(ls -t ../build-*.ipa ./build/*.ipa 2>/dev/null | head -1 || true)
fi

echo ""
if [[ -n "${IPA}" ]]; then
  echo "==> IPA gevonden: $IPA"
  echo "==> Submit naar App Store Connect / TestFlight"
  eas submit -p ios --path "$IPA" --profile production
else
  echo "Geen .ipa in de app-map gevonden."
  echo "Als de build klaar is, run:"
  echo "  eas submit -p ios --path ./JOUW.ipa --profile production"
fi
