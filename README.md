# MetSac Fabrika

MetSac A.Ş. için tarayıcı tabanlı, Factorio esintili bir değer akışı simülasyonu.

Canlı sürüm: https://metsac-fabrika.noktafa.workers.dev/

## Yerelde çalıştırma

Proje derleme adımı veya harici bağımlılık gerektirmez. ES modülleri ve
`fetch()` kullanıldığı için bir yerel HTTP sunucusuyla açın:

```sh
python3 -m http.server 8080
```

Ardından http://localhost:8080/ adresini açın.

## Yapı

- `index.html`: Uygulama kabuğu
- `data/factory.json`: Fabrika, istasyon ve senaryo verileri
- `src/sim/`: Simülasyon motoru
- `src/ui/`: Canvas çizimi, kamera, parçacıklar ve sprite'lar
- `src/hud/`: Kontroller ve KPI panelleri
- `src/story/`: Brifing ve tanıtım turu

## Dağıtım

Kök dizin doğrudan statik site olarak Cloudflare Pages, Railway veya benzeri
bir statik barındırma hizmetine dağıtılabilir.
