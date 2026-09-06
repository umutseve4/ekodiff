<h1 align="center">EkoDiff · Akademik Zaman Makinesi</h1>

<p align="center">
  <b>Bir müfredat sessizce değişir.</b> Ders kodu taşınır, AKTS kayar, seçmeli havuzu<br>
  yeniden yazılır, eski sayfa yayından kalkar. Geçen yılın planına göre hazırlanmış<br>
  öğrenci bu değişimi hiçbir yerde göremez — çünkü kimse müfredatı sürümlemiyor.
</p>

<p align="center">
  <a href="https://github.com/umutseve4/ekodiff/actions/workflows/verify.yml"><img src="https://github.com/umutseve4/ekodiff/actions/workflows/verify.yml/badge.svg" alt="verify"></a>
  <img src="https://img.shields.io/badge/ba%C4%9F%C4%B1ml%C4%B1l%C4%B1k-0-FF4D4F?style=flat-square" alt="Sıfır bağımlılık">
  <img src="https://img.shields.io/badge/AKTS%20uyu%C5%9Fmazl%C4%B1%C4%9F%C4%B1-241%20vs%20240-FF4D4F?style=flat-square" alt="241 vs 240 AKTS">
</p>

<p align="center"><b><a href="https://umutseve4.github.io/ekodiff/">▶ Aracı aç</a></b></p>

---

## 30 saniyede ne oluyor?

İki şey yapabilirsiniz:

1. **EkoDiff** — Bursa Uludağ Üniversitesi İİBF Ekonometri lisans programının tarihli, kaynak künyeli *sürümlerini* seçip iki sürüm arasındaki farkı çıkarırsınız. Kod taşınması, AKTS kayması, kaldırılan ders — hepsi tek listede.
2. **Akademik Zaman Makinesi** — tamamen tarayıcıda çalışan senaryo motoru: "şu dersten DC alırsam ne olur", "3.00 hedefi için kalan AKTS'de hangi ortalamayı tutturmam gerekir", "şartlı geçtiğim krediler hâlâ sayılıyor mu".

Hiçbir veri sunucuya gitmez. Girdiğiniz her şey `localStorage`'da kalır ve tek düğmeyle geri dönüşsüz silinir.

> **Bu bağımsız bir öğrenci projesidir.** Bursa Uludağ Üniversitesi tarafından
> hazırlanmamış, onaylanmamış veya desteklenmemiştir. Resmî bilgi için bölüm
> başkanlığına ve Öğrenci İşleri'ne başvurun. Buradaki hiçbir çıktı resmî
> transkript, muafiyet veya mezuniyet kararı yerine geçmez.

---

## Neden başka bir "not hesaplayıcı" değil

Ortalama hesaplayan araç zaten çok. Bu projenin var olma sebebi başka bir yerde:
**bilmediğini bildirmesi.**

| Sorun | Sıradan araç | Bu araç |
|---|---|---|
| Kısmi bir müfredat kaydında ders görünmüyor | "kaldırıldı" der | `kaldırıldı mı? bilinmiyor` der ve neden bilmediğini yazar |
| Ders kodu MAT1501 → EKO1001 olmuş | 1 silme + 1 ekleme gösterir | `kodu değişti` olarak tek kayıtta eşler |
| Aynı ada sahip iki ders var, eşleme belirsiz | rastgele birini eşler | **eşlemeyi reddeder** ve ikisini de ayrı gösterir |
| Harf notu tahmini | uydurur | üretmez — bağıl değerlendirme sınıf dağılımı gerektirir, o veri yok |
| Not katsayı tablosunun kaynağı | sessizce varsayılan bir tablo kullanır | yönetmelik maddesini künyesiyle verinin içine gömer (MADDE 32/(3)) ve kaynaksız her tabloyu uyarıyla işaretler |
| DC/DD şartlı geçme | statik "geçti" sayar | GANO 2.00'nin altına düşünce **kredinin kaybedildiğini** gösterir |

Son satır bu projenin en özgün parçası. Şartlı geçme dinamiktir: DC/DD ile
geçilen bir ders yalnızca genel ortalama 2.00 ve üzerindeyken kredi sayılır.
Yani kazanılmış kredi sonradan *kaybedilebilir* — statik bir transkriptin asla
göstermediği tam olarak budur.

---

## Not katsayıları nereden geliyor

Tablo varsayılmıyor, **alıntılanıyor.** Kaynak: *Bursa Uludağ Üniversitesi
Önlisans ve Lisans Eğitim Öğretim Yönetmeliği*, **MADDE 32/(3)** (Resmî Gazete
20.09.2020 / 31250). Künye `site/data/rules/assessment.json` içinde
`scale.verifiedAgainst` altında, sayıların hemen yanında durur.

| Harf | Katsayı | Durum |
|---|---|---|
| AA | 4.00 | Geçer (Mükemmel) |
| BA | 3.50 | Geçer (Pekiyi) |
| BB | 3.00 | Geçer (İyi) |
| CB | 2.50 | Geçer (Orta) |
| CC | 2.00 | Geçer (Geçer) |
| DC | 1.50 | **Koşullu** geçer |
| DD | 1.00 | **Koşullu** geçer |
| FD | 0.50 | Başarısız |
| FF | 0.00 | Başarısız |
| (D) | 0.00 | Devamsız — ortalamaya **FF olarak** dâhil edilir |

GANO'ya **girmeyen** işaretler — S (Süren Çalışma), E (Eksik), G (Geçer),
K (Kalır), M (Muaf), İ (İptal) — bilerek katsayı tablosunda değildir. Biri yine
de girilirse motor onu hesaba katmaz ve nedenini yazılı olarak döndürür.

**Puandan harfe çevirmiyoruz.** Yönetmelik harf notları için sabit bir 100'lük
aralık tanımlamaz; bağıl değerlendirme uygulanır ve harf, tüm sınıfın
dağılımına bağlıdır. "70 alırsan BB olur" demek, kesinlik kılığına girmiş bir
uydurma olurdu. Bir test bu bantların veriye sızmasını engeller.

---

## Mimari

```
site/                 ← GitHub Pages bu dizini olduğu gibi yayınlar
  index.html
  style.css
  app.js              ← yalnızca DOM ve localStorage; iş mantığı yok
  modules/
    snapshot.js       ← veri modeli + doğrulama
    diff.js           ← EkoDiff motoru
    rules.js          ← mutlak değerlendirme kapıları
    simulate.js       ← Zaman Makinesi (sıfır I/O)
  data/
    index.json        ← manifest (HTTP üzerinden dizin listelenemez)
    rules/assessment.json
    snapshots/*.json
tests/                ← node:test, sıfır bağımlılık
tools/dom-smoke.mjs   ← arayüzü sahte DOM üzerinde çalıştıran duman testi
```

**Derleme adımı yok.** Testlerin okuduğu dosyalar ile tarayıcının indirdiği
dosyalar birebir aynıdır; aralarında sürüm kayması ihtimali bulunmaz.

**Bağımlılık yok.** Ne `dependencies` ne `devDependencies`. CI bunu bir test
olarak zorunlu kılar.

---

## Veri modeli: iki ayrı eksiklik ekseni

Her snapshot iki farklı "bilmiyorum"u ayrı ayrı beyan eder:

- `scope` — bu snapshot neyi kapsamayı iddia ediyor? (`"zorunlu dersler, 1.–8. yarıyıl"`)
- `completeness` — kapsam içindeki **ders kümesi** eksiksiz mi? (`full` / `partial`)
- `covered_fields` — her dersin hangi **alanları** gerçekten kaydedildi?

Bunları tek bir bayrağa indirmek bir yönde yalan söylemeyi zorunlu kılardı: bir
snapshot kapsamındaki her dersi listeleyip AKTS'lerini hiç bilmiyor olabilir.

`completeness: "full"` asla "tüm üniversite" demek değildir; **"bu scope içinde
eksiksiz"** demektir. Farklı `scope`'lu iki snapshot karşılaştırılırsa rapor
`certain: false` döner ve uyarıyı ekrana basar.

---

## Yasal ve etik sınırlar

- **Yalnızca kamuya açık kaynaklar:** Bilgi Paketi ders/program sayfaları,
  akademik takvim, bölüm duyuruları, Resmî Gazete'de yayımlanmış yönetmelik.
  UNİSİS, transkript, not, devam ve sınıf listesi verisi **kullanılmaz**.
- **Merkezî veri toplanmaz.** Ad, e-posta, öğrenci numarası, not — hiçbiri
  hiçbir sunucuya gitmez. Girilen her şey tarayıcının `localStorage` alanında
  kalır ve tek düğmeyle geri dönüşsüz silinir.
- **Üniversite logosu, kurumsal renkleri veya alan adı kullanılmaz.**
- **Provenance dürüsttür.** Müfredat verisi otomatik toplanmamış, elle
  aktarılmıştır: her snapshot `provenance: "user-transcribed"` taşır. CI bu
  alanın gerçek bir fetch hattı kurulana kadar değiştirilmesini engeller.
  Not tablosu bunun istisnasıdır: `provenance: "regulation-text"` taşır, çünkü
  bağlayıcı yönetmelik metninden doğrudan okunmuştur.

---

## Kaynaklar arası uyuşmazlıklar

Aşağıdakiler **"hata" değil**, kaynaklar arası uyuşmazlıktır ve düzeltilmeden,
olduğu gibi kaydedilmiştir. Doğrusunu yalnızca bölüm başkanlığı ve Öğrenci
İşleri söyleyebilir:

1. `EKO2004` kodu aynı katalogda hem zorunlu *Bilgisayar Programlama ve VBA
   Uygulamaları* hem 4. yarıyıl seçmeli *Ofis Programları – Kelime İşlem* için
   kullanılıyor.
2. `EKO3306`/`IKT3306` kodu 6. yarıyıl seçmelilerinde hem *İktisadi Planlama*
   hem *Doğal Kaynaklar Ekonomisi* için tekrar ediyor.
3. `EKO4305` kodu hem zorunlu *Benzetim* hem 7. yarıyıl seçmeli *Yöneylem
   Araştırması Bilgisayar Uygulamaları* olarak geçiyor.
4. Yarıyıl AKTS toplamlarının aritmetiği **241** veriyor; program **240 AKTS**
   ilan ediyor. Fark `EKO1003 Kariyer Planlama` dersinin 1 AKTS'sinden geliyor.
   Bu, `tests/data.test.js` içinde bir test olarak sabitlenmiştir.

---

## Bilinen sınırlamalar

- **Harf notu hesaplanmaz.** BUÜ bağıl değerlendirme kullanır; harf notu tüm
  sınıfın dağılımına bağlıdır. Bu proje o veriyi ne toplar ne tahmin eder.
  Yalnızca mutlak kapılar değerlendirilir: %70 devam, 30 puan final barajı,
  40 puan ham başarı alt sınırı.
- **Katsayı tablosu doğrulanmıştır, ama zamana karşı değil.** Tablo MADDE
  32/(3)'ten alındı (bkz. yukarıdaki bölüm); yönetmelik değişirse bu depo bunu
  kendiliğinden fark etmez. `verified_at` tarihi bu yüzden veride durur.
- **Bölüme özgü uygulama farkları modellenmemiştir.** Bağıl değerlendirme
  parametreleri (BDKS/HBAS/YSSL) her yıl Senato tarafından belirlenir; bu
  değerler burada yoktur.
- **Önkoşullar modellenmemiştir.** Yalnızca `EKO3101 + EKO3102 → EKO4102` zinciri
  doğrulanabildi. Diğer dersler için "önkoşulu yok" sonucu çıkarılmamalıdır.
- **Seçmeli havuzu eksiktir.** Yalnızca yazılım/veri odaklı alt küme
  kaydedilmiştir ve `partial` olarak işaretlidir.
- **2018-2019 arşiv snapshot'ı kasıtlı olarak iki ders içerir.** Var olma sebebi
  tek bir olgudur: MAT1501/MAT1502 → EKO1001/EKO1002 kod taşınması.

---

## Geliştirme

```bash
npm test                 # node:test, sıfır bağımlılık
npm run smoke            # arayüzü sahte bir DOM üzerinde gerçek verilerle çalıştırır
npm run verify           # ikisi birden — CI'ın koştuğu komut
python3 -m http.server -d site 8080   # yerelde çalıştır
```

`npm run smoke` neden var: ortamda tarayıcı olmadığı için `tests/ui.test.js`
yalnızca statik sözleşmeleri denetleyebiliyor (id bütünlüğü, üçüncü taraf varlık
yokluğu, uyarı metinlerinin varlığı). Bu, statik analizin göremediği tek hata
tipini açıkta bırakıyordu: `app.js`'in ilk yüklemede exception atması.
`tools/dom-smoke.mjs` bu boşluğu kapatır — uygulamayı gerçek veri dosyalarıyla
başlatır, 9 snapshot çiftinin tamamını, filtreleri, transkripti, what-if'i,
hedef GANO'yu ve silme düğmesini tetikler. Tarayıcı değildir: yerleşim, CSS ve
gerçek olay sırası kapsam dışıdır. Yalnızca tek bir şeyi kanıtlar — *tetiklenen
hiçbir yolda istisna atılmıyor*.

Yeni bir snapshot eklerken:

1. `site/data/snapshots/<snapshot_id>.json` oluştur (dosya adı `snapshot_id` ile
   birebir aynı olmalı — test bunu zorunlu kılar).
2. `site/data/index.json` manifestine ekle.
3. `npm test` çalıştır. Doğrulama, manifest tutarlılığı ve provenance kontrolü
   otomatik koşar.

Testler ağırlıklı olarak **negatif** testlerdir: doğru davranışı değil, yanlış
iddiada bulunmayı engelleyen davranışı sabitlerler. Beş kasıtlı mutasyonla
(hayalet kaldırma, şartlı kredinin hep sayılması, kaynaksız bir tablonun
uyarısının susturulması, belirsiz recode'un kabul edilmesi, `scope`
zorunluluğunun kaldırılması) her birinin en az bir testi kırmızıya çevirdiği
doğrulanmıştır. Katsayı tablosu da artık aynı korumaya sahiptir: dokuz harf
notundan birinin değeri kayarsa test kırmızıya döner.

---

## Bu proje ne zaman arşivlenmeli

Dürüstlük gereği eşikler baştan yazılmıştır:

- Müfredat verisi **12 aydan uzun süre** yeniden doğrulanmadıysa, site
  "bayat veri" uyarısını göstermeli veya depo arşivlenmelidir.
- Not tablosunun **künyesi geçersizleşirse** — yönetmelik değişip
  `scale.verifiedAgainst` artık yürürlükteki metni göstermiyorsa — tablo derhal
  yeniden doğrulanmalı, doğrulanamıyorsa GANO özelliği kaldırılmalıdır; yanlış
  bir ortalama, ortalama olmamasından kötüdür.
- Üniversite resmî bir sürümlü müfredat API'si yayınlarsa, EkoDiff'in var olma
  sebebi ortadan kalkar. O gün gelirse depo arşivlenir.

---

## Yayın durumu

`pages` iş akışının yeşil olması sitenin yayında olduğu anlamına **gelmez.**
GitHub Pages kapalıyken testler geçer, dağıtım adımları atlanır ve koşu bir
uyarı ile yeşil biter. Yayına almak için tek seferlik bir el işi gerekir:
**Settings → Pages → Source: GitHub Actions**, ardından `pages` iş akışını
yeniden çalıştırın. Bir iş akışı jetonunun bunu yapmaya yetkisi yok.

---

MIT — bkz. [LICENSE](LICENSE). Müfredat verisinin kendisi BUÜ'ye aittir; bu depo
yalnızca kamuya açık sayfalardan elle aktarılmış, tarihli ve kaynak künyeli
kayıtları barındırır.
