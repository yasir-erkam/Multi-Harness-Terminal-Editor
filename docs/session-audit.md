# Session işlevsellik incelemesi

İnceleme tarihi: 2026-10-21. Taban: uzak depodan doğrulanan `v0.8.18` (`85772d4`); hedef paket: `0.8.20`. Kapsam: kayıtlı geçmişi keşfetme/okuma, proje ve agent filtresi, devam etme, terminal kimliği, sekme kapatma, tekli/toplu silme, seçim ve kart/liste komutları. Bulgular bu depodaki uygulamaya aittir; kurulu bütün CLI sürümleriyle canlı entegrasyon testi yapılmadı.

## Agent bazında sonuç

| Agent | Geçmiş / devam et | Kayıt silme | Silince açık sekme |
| --- | --- | --- | --- |
| DeepSeek Harness | Var; JSONL ve Zstandard | Var; eşleşen dosya sürümleri de kaldırılır | Geçmişten açılmış session kimliğiyle eşleşir; yeni session canlı izlenmez |
| OpenCode | Var; SQLite veya eski JSON | Desteklenmiyor; salt okunur | Silme akışı yok |
| Claude Code | Var | Var | Geçmişten açılmış session kimliğiyle eşleşir; yeni session canlı izlenmez |
| Codex | Var | Var | Linux'ta canlı rollout; Windows'ta yazılabilir dosya handle'ı ve terminalin Codex süreç ağacıyla yeni/değiştirilmiş session eşleşir. Keşif yapılamazsa resume kimliği kullanılır |
| Pi Agent | Var | Var | Geçmişten açılmış session kimliğiyle eşleşir; yeni session canlı izlenmez |
| Gemini CLI | Desteklenmiyor | Desteklenmiyor | Open Terminals üzerinden sekme kapatılabilir |
| Goose | Desteklenmiyor | Desteklenmiyor | Open Terminals üzerinden sekme kapatılabilir |
| Aider | Desteklenmiyor | Desteklenmiyor | Open Terminals üzerinden sekme kapatılabilir |
| Oh My Pi | Var | Var | Güncel terminal breadcrumb dosyasıyla yeni ve değiştirilmiş session eşleşir; okunamazsa resume kimliğine döner |
| Crush | Desteklenmiyor | Desteklenmiyor | Open Terminals üzerinden sekme kapatılabilir |
| Qwen Code | Desteklenmiyor | Desteklenmiyor | Open Terminals üzerinden sekme kapatılabilir |
| Prime Agent | Var | Var | Geçmişten açılmış session kimliğiyle eşleşir; yeni session canlı izlenmez |
| Copilot CLI | Desteklenmiyor | Desteklenmiyor | Open Terminals üzerinden sekme kapatılabilir |
| Antigravity CLI | Var; SQLite | Desteklenmiyor; salt okunur | Silme akışı yok |
| Cursor Agent | Desteklenmiyor | Desteklenmiyor | Open Terminals üzerinden sekme kapatılabilir |

## Düzeltilen bulgular

1. **DeepSeek silinen session'ın tekrar görünmesi:** yalnızca son dosya sürümü siliniyordu; sonraki tarama eski sürümü bulabiliyordu. Aynı klasördeki bilinen sürüm dosyalarının tamamı session kimliği, proje ve depo sınırı açısından doğrulanır. Eski sürümler önce, listelenen dosya en son kaldırılır. Başka kimlik içeren bir sürüm varsa işlem reddedilir; alt klasörler ve artifact dosyaları silinmez.
2. **Claude Code geçerli kaydın silinememesi:** ilk kimlik içeren metadata satırında `cwd` bulunmaması silmeyi engelliyordu. Kimliklerin tamamı denetlenmeye devam eder; proje doğrulaması `cwd` içeren ilk eşleşen satırdan yapılır. Hiç doğrulanabilir proje satırı yoksa silme reddedilir.
3. **DeepSeek sıkıştırılmış kaydın silinememesi:** Zstandard blokları arasında bölünen JSON veya UTF-8 karakterleri ayrı satırlarmış gibi işleniyordu. Satır ve karakter parçaları doğrulama sırasında birleştirilir.
4. **Terminal kapanma hatasının silme hatası sayılması:** kayıt silindikten sonra `dispose()` hata verirse gereksiz kalıcı silme onayı açılabiliyordu. Dosya silme ve sekme kapatma sonuçları ayrıldı; bir terminal hata verse de diğer eşleşen terminaller kapatılır. Kapatma hatası ayrıca bildirilir.
5. **Desteklenmeyen agent'larda silme kontrolleri:** silme desteği yalnızca iki agent hariç hepsine açık kabul ediliyordu. Artık yalnızca altı destekli sağlayıcı kabul edilir; boş/bilinmeyen agent da reddedilir.
6. **Silme sırasında devam et yarışı:** komut doğrudan çağrıldığında onay/silme devam ederken yeni terminal başlatılabiliyordu. Devam et komutu silme süresince engellenir; dosya kontrollerinden sonra proje kapsamı yeniden denetlenir.
7. **OMP yanlış sekmede devam etme / yinelenen terminal:** eşleştirme yalnızca ilk resume kimliğine bakıyordu. Güncel breadcrumb varsa mevcut session dosyası esas alınır; yeni session'ın terminali de tekrar kullanılır. Asenkron kimlik okuması sırasında kapanan terminaller tekrar kullanılmaz.
8. **macOS OMP yeni session eşlemesi:** açık terminal kimliği ve breadcrumb okuma yalnızca Windows/Linux için uygulanmıştı. macOS terminaline de `TERM_SESSION_ID` atanır ve ilgili breadcrumb okunur.
9. **Windows Codex session silinince sekmenin açık kalması:** 0.8.18/0.8.19 yalnızca Linux `/proc` üzerinden yeni Codex session'ını eşleyebiliyordu. Windows'ta Restart Manager ile dosya sahipliği bulunur, native process handle tablosundan yazma erişimi doğrulanır ve terminalin Codex süreç ağacıyla eşleştirilir. Salt okuyan süreçler, başka terminaller, iç içe tool agent'ları ve yeniden kullanılan PID'ler dışlanır. Sorgu gizli PowerShell sürecinde zaman/bellek sınırlarıyla çalışır; dosyayı silmeden önce kimlik yeniden doğrulanır.

## Devam eden sınırlar

- **Sekmenin açık kalması hâlâ mümkün.** Claude Code, Pi, Prime Agent ve DeepSeek için yeni başlatılan terminalin oluşturduğu session kimliği alınmıyor. Codex'te Linux/code-server canlı rollout ve Windows yazılabilir handle keşfi bu sorunu giderir; macOS, okunamayan `/proc`, kısıtlı PowerShell/CIM/native handle erişimi veya terminal süreç ağacı dışında çalışan writer durumunda sınır sürer. Kimliği bulunamayan terminaller silme sonrası otomatik kapatılamayabilir.
- **Session terminal içinde değiştirilirse kimlik eski kalabilir.** OMP breadcrumb ile Linux/Windows Codex canlı dosya eşlemesi silme hedefini güncel dosyadan belirler. Bunlar okunamadığında veya diğer sağlayıcılarda ilk resume kimliği kullanılabilir. Codex'in canlı dosya keşfi yalnızca silme yolundadır; devam et komutu hâlâ ilk resume kimliğini kullanır. Eski kaydın silinmesi artık başka konuşmayı çalıştıran sekmeyi kapatabilir veya devam et yanlış sekmeyi gösterebilir. Başlık/proje benzerliğine bakarak eşleştirme eklenmedi; aynı projede birden çok gerçek session olabilir. Güvenli kullanım: ilgili terminali Open Terminals üzerinden kapatıp geçmişi sonra silmek.
- **Yeniden bağlanma platforma bağlı.** Kimlik `creationOptions.env` üzerinden kurtarılamazsa çalışan süreçten `/proc` ile kurtarma yalnızca Linux'ta var. Windows/macOS'ta kimliği kaybolan terminalin kayda bağlılığı garanti edilmez.
- **Canlı yazıcıyla atomik silme yok.** Dosya silindikten sonra terminal kapatılır. Henüz eşleştirilememiş çalışan bir CLI geçmişi tekrar oluşturabilir. Çok dosyalı DeepSeek silme işlemi de atomik değildir: kısmi başarısızlıkta listelenen sürüm korunur, silinemeyen session seçili kalır.
- OpenCode ve Antigravity için silme entegrasyonu; diğer yedi agent için kayıtlı geçmiş entegrasyonu mevcut değil. Bunlar başarısız çalışan silme işlemleri değildir; desteklenmeyen özelliklerdir.
- Geçmiş taramaları sınırlıdır: listede en çok 100 session, sınırlandırılmış klasör/dosya gezintisi ve metadata pencereleri kullanılır. Liste, tüm sağlayıcı geçmişinin eksiksiz dökümü değildir.

## Doğrulama

- `npm.cmd run compile`: Windows Codex düzeltmesiyle TypeScript, bundle, 61 test grubu, manifest ve workflow kontrolleri Node.js 24.12.0 ile başarılı. İstenen Node 22 bu ortamda bulunamadı; geçici paket edinme denemeleri tamamlanamadı. Node 22 ile doğrulama yapılmış sayılmaz.
- `npm.cmd run dev:install`: 0.8.20 için bütün kontroller yeniden geçti ve `artifacts/multi-harness-terminal-editor-0.8.20.vsix` üretildi. code-server kurucusu bulunmadığından bu akışın kurulum adımı başarısız oldu. Kullanıcının Windows masaüstü VS Code kullandığı doğrulandıktan sonra yerel `code.cmd --install-extension ... --force` ile 0.8.20 başarıyla kuruldu; kurulu manifest ve bundle'daki Windows eşleştirme kodu ayrıca doğrulandı. Kullanıcının Developer: Reload Window çalıştırması gerekli.
- `git diff --check`: başarılı.
- Gerçek geçici dosyalar ve kayıt tutan VS Code stublarıyla altı yazılabilir sağlayıcının her biri için silme ve direct/shell sekme kapatma kontrolü eklendi.
- Metadata doğrulaması, farklı kimlik/proje, depo dışı dosya, çok bloklu sıkıştırma, eski DeepSeek sürümleri, terminal kapatma hatası ve silme sırasında devam et regresyonları eklendi.
- Mevcut testler tekli/toplu seçim, iptal, Trash başarısızlığı, ayrı kalıcı silme onayı, kısmi başarısızlık, paralel silme komutları, eski kimlikler, proje kapsamı, stale taramalar, kart/liste komutları ve yeniden etkinleşmeyi kontrol eder.
- Windows tanımlı OMP devam et/silme ve macOS tanımlı breadcrumb senaryoları eklendi. Platform tanımlı testler gerçek macOS/Linux host testinin yerine geçmez.
- 0.8.18'in Linux Codex canlı rollout, wrapper, yeniden bağlanma ve session değiştirme regresyonları korundu; bu Windows çalıştırmasında Linux koşullu testler yürütülmedi.
- Windows'ta gerçek native API ve geçici bir Codex adlı test süreciyle writable/read-only handle, direct/launcher terminali, session değiştirme, iptal ve silme başarısızlığı testleri geçti. Bu, gerçek Codex CLI ve VS Code arayüzünde elle yapılan uçtan uca test değildir.
- Canlı VS Code/CLI etkileşimi ve ekran görüntüsü doğrulaması bu ortamda yapılmadı. Windows dosya symlink senaryoları izin olmadığı için testler tarafından atlanır.
