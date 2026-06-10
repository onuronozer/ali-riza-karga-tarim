# Ali Rıza Karga TARIM

Kayısı alım, çiftçi cari, firma cari, ödeme ve rapor takibi için hazırlanan masaüstü ve mobil web uygulaması.

## Öne Çıkanlar

- Masaüstünde internet olmadan çalışma
- İnternet geldiğinde Firebase ile otomatik senkron
- Mobil web üzerinden aynı verileri görme ve fiş girişi
- A5 alım fişi ve çiftçi ödeme fişi yazdırma
- Çiftçi ve firma şahsi cari pencereleri
- Gün bazlı alım listeleri ve rapor ekranları

## Kullanım

```powershell
npm install
npm run dev
```

Kontrol:

```powershell
npm run typecheck
```

Mobil web geliştirme:

```powershell
npm run mobile:dev
```

Mobil web yayın paketi:

```powershell
npm run mobile:build
```

## Firebase

Firebase Authentication tarafında Email/Password açık olmalı. Firestore kuralları giriş yapan kullanıcıya okuma ve yazma izni verecek şekilde ayarlanır:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Mobil web yayını GitHub Pages üzerinden `.github/workflows/deploy-mobile.yml` dosyasıyla otomatik yapılır.
