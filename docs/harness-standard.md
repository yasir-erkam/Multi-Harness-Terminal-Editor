# Harness özellik ve oturum yaşam döngüsü standardı

Bu belge, Multi-Harness Terminal Editor için hedef davranış sözleşmesidir. Yeni harness ekleme ve mevcut entegrasyonları tamamlama ölçütü olarak kullanılır. **Bir gereksinimin burada yazması, kodda tamamlandığı anlamına gelmez.** Aşağıdaki mevcut destek matrisi 2026-10-28 tarihli kaynak kod incelemesidir; kurulu bütün CLI sürümleriyle canlı doğrulama değildir.

## 1. Kapsam ve terimler

- **Harness:** Ayrı kurulan ve kendi kimlik doğrulamasını yapan CLI ile eklenti arasındaki entegrasyon.
- **Kayıtlı oturum:** Sağlayıcının yerel geçmişindeki konuşma. Terminal kapalıyken de vardır.
- **Canlı terminal:** VS Code'un yönettiği terminal nesnesi ve ona bağlı süreçler. Açık sekme, konuşmanın çalıştığının kanıtı değildir.
- **Başlatma kimliği:** Terminal yaratılırken kaydedilen harness/oturum bilgisi. CLI içinde konuşma değiştirilirse eskiyebilir.
- **Güncel oturum kimliği:** Terminalin şu anda kullandığı konuşmayla doğrulanmış bağlantı. Başlık veya aynı proje klasörü tek başına bu bağlantıyı kanıtlamaz.
- **Sekmeyi kapat:** Yalnızca hedef terminale `dispose()` uygula. Kayıtlı geçmişi silmez; VS Code'un terminal/süreç sonlandırma mekanizmasını kullanır. Harici veya paylaşımlı daemon'un da durduğu varsayılmaz.
- **Oturumu sil:** Sağlayıcının desteklenen yerel geçmiş birimini kaldır. Başarıdan sonra yalnızca o oturuma bağlılığı doğrulanmış yerel terminal sekmelerini kapat.

**MUST / MUST NOT:** Zorunlu / yasak. **SHOULD:** Sapma varsa gerekçesi ve kullanıcıya etkisi belgelenmeli. **MAY:** İsteğe bağlı. Bu sözcükler aşağıda hedef standardı belirtir.

## 2. Destek modeli

Bütün harness'ların hedefi ortak kullanıcı deneyimidir; sağlayıcının desteklemediği işlem taklit edilmez. Tek bir `supported` bayrağı yerine şu yetenekler ayrı değerlendirilir:

| Yetenek | Gereken davranış |
| --- | --- |
| Temel terminal | Yeni terminal, executable/argüman ayarı, proje bağlamı, odaklama, tek sekme kapatma, yeniden bağlanma |
| Kayıtlı geçmiş | Yerel geçmiş keşfi, agent/proje filtresi, güncelleme, kesin kayıttan devam etme |
| Güvenli silme | Tekli/toplu onaylı silme, sağlayıcıya uygun güvenli mutasyon, kısmi hata yönetimi |
| Canlı kimlik | Yeni, devam ettirilmiş ve terminal içinde değiştirilmiş oturumu doğru terminalle eşleme |

Her yetenek için **destekli**, **kısıtlı**, **uygulanmamış** veya **sağlayıcı tarafından desteklenmiyor** durumu belirtilmeli. Son ikisi aynı değildir: bu depoda kod bulunmaması, CLI'ın özelliği sunmadığı anlamına gelmez. Platform, CLI biçimi/sürümü ve extension-host API gereksinimleri ayrıca yazılmalı. Bir yetenek geçici olarak kullanılamıyorsa bu, desteklenmeyen özellik veya boş geçmiş gibi gösterilmemeli.

## 3. Bütün harness'lar için temel gereksinimler

| Kimlik | Gereksinim |
| --- | --- |
| BASE-01 | Harness MUST sabit bir ID ile registry, komut, terminal profili, ayar, ikon ve yerelleştirmelerde tutarlı tanımlanmalı. |
| BASE-02 | Yeni konuşma komutu MUST her çağrıda yeni terminal açmalı. Var olan terminale geçiş ayrı bir eylem olmalı. |
| BASE-03 | CLI MUST extension-host ortamında çözümlenmeli; istemci bilgisayarında kurulu olduğu varsayılmamalı. Eksik executable anlaşılır hata ve ilgili ayara erişim sunmalı. |
| BASE-04 | Yeni terminal MUST aktif editörün projesini, sonra hâlâ geçerli hatırlanan projeyi, sonra ilk workspace klasörünü kullanmalı; proje yoksa home'a düşebilmeli. Resume MUST kayıtlı projenin çalışma dizini ve kaynak kapsamlı ayarlarını kullanmalı. |
| BASE-05 | Direct/shell başlatma ve terminal profilleri MUST belgelenmiş farklılıklar dışında aynı executable, argüman ve proje çözümlemesini kullanmalı. Sağlayıcının argüman sırası korunmalı. |
| BASE-06 | Open Terminals MUST kesin terminal nesnesini odaklamalı veya kapatmalı. Aynı başlıkta başka terminal etkilenmemeli. |
| BASE-07 | Sekme kapatma MUST geçmiş kaydını korumalı. CLI normal çıkışı veya çökmesi de geçmiş silme sayılmamalı. |
| BASE-08 | Başlık değişikliği MUST kalıcı kimliği bozmamalı. Konuşma konusu bulunduğunda başlık güncellenebilmeli; bulunamazsa başka konuşmanın başlığı kullanılmamalı. |
| BASE-09 | Reload/deactivation MUST agent'ı yeniden başlatmamalı veya terminali öldürmemeli. Terminal kalıcılığı VS Code ayarları ve host desteğine bağlı olarak belgelenmeli. |
| BASE-10 | Yerel VS Code listeleri MUST aynı yetenek, seçim, kapsam ve komut doğrulamasını kullanmalı. Doğrudan komut çağrıları da görünümdeki destek ve hedef kontrollerini uygulamalı. |
| BASE-11 | Yeni kullanıcı mesajları MUST İngilizce/Türkçe eşleşen yerelleştirme anahtarlarıyla sunulmalı. Trusted, non-virtual workspace sınırı korunmalı. |
| BASE-12 | Çalışıyor/bitti göstergesi MUST yalnızca gözlemlenen süreç/shell olaylarını anlatmalı; modelin düşündüğü, yanıtladığı veya tamamladığı iddia edilmemeli. |
| BASE-13 | Yeni direct/profile terminalleri MUST varsayılan olarak yalnızca başarılı CLI çıkışında otomatik kapanmalı. Hatalı, sinyalli ve bilinmeyen çıkışlar açık tutulmalı; `never`/`always` ayarı başlatmada uygulanmalı. Shell komutunun bitmesi açık shell'i kapatmamalı; hiçbir çıkış politikası kayıtlı geçmişi silmemeli. Çıktısı tutulan ama CLI'ı bitmiş terminal resume için çalışan oturum sayılmamalı. |

## 4. Geçmiş listeleme ve devam etme

| Kimlik | Gereksinim |
| --- | --- |
| HIST-01 | Liste MUST sağlayıcının gerçek yerel kayıtlarından türetilmeli; açık terminallerden veya başlıklardan geçmiş üretilmemeli. |
| HIST-02 | Kayıt MUST harness ID, oturum ID, kayıt konumu ve proje bilgisiyle ayrıştırılmalı. Aynı başlıklı konuşmalar birleşmemeli. |
| HIST-03 | Current location MUST yalnızca seçilen agent ve kanonik proje eşleşmesini göstermeli. All locations yalnızca proje filtresini kaldırmalı; agent filtresi ve sonuç sınırı kalmalı. |
| HIST-04 | Liste SHOULD konu ve son konuşma etkinliğini göstermeli. Yalnızca metadata/resume yazılması konuşmayı yeni mesaj varmış gibi üste taşımamalı; zaman fallback'i belgelenmeli. |
| HIST-05 | Eksik store MUST normal boş durum olarak ele alınmalı. İzin, bozuk store veya eksik SQLite/decompression desteği nedeniyle okunamama ayrı bildirilmeli; diğer sağlayıcıları bozmamalı. |
| HIST-06 | Taramalar MUST dosya sayısı, okuma boyutu ve sonuç sayısıyla sınırlı olmalı. İptal, kapsam değişimi, disposal ve geç gelen eski sonuçlar gözetilmeli. Liste tüm geçmişin eksiksiz dökümü diye sunulmamalı. |
| HIST-07 | Liste MUST elle yenilenebilmeli; otomatik yenileme üst üste tarama başlatmamalı. Yeni, yeniden adlandırılmış ve dışarıdan silinmiş kayıtlar iki görünümde de güncellenmeli. |
| HIST-08 | Resume MUST seçilen kesin oturumu sağlayıcının native argümanlarıyla açmalı. Eksik/değişmiş kayıt veya bulunamayan proje sessizce yeni konuşmaya dönüşmemeli. |
| HIST-09 | Aynı oturuma eşzamanlı resume MUST tek bekleyen başlatmayı paylaşmalı. Doğru canlı terminal varsa odaklanmalı; farklı oturumlar bağımsız kalmalı. Başarısız başlatma sonraki denemeyi kilitlememeli. |
| HIST-10 | Resume MUST mümkünse güncel kimliği kullanmalı. Kimliğin değişmiş olabileceği durumda ilk resume ID'sine dayanarak başka konuşma odaklanmamalı. |
| HIST-11 | Başka penceredeki yazıcı güvenilir biçimde tespit edilebiliyorsa ikinci writer SHOULD engellenmeli. Best-effort keşif atomik, pencereler arası kilit olarak sunulmamalı. |

## 5. Silme ve sekme kapatma sözleşmesi

### 5.1 Kullanıcı işlemleri

| Eylem | Kayıtlı geçmiş | Terminal |
| --- | --- | --- |
| Sekmeyi kapat | Korunur | Yalnızca seçilen terminal kapatılır |
| Oturuma devam et | Korunur | Doğru mevcut terminal odaklanır; yoksa bir terminal açılır |
| Silmeyi iptal et | Değişmez | Açık kalır |
| Kayıt silinemedi | Başarısız/kısmi sonuç açıkça bildirilir | Başarısız hedefe bağlı terminal kapatılmaz |
| Kayıt silindi | Desteklenen yerel silme birimi kaldırılır | Doğrulanmış eşleşen yerel terminallerin tamamı kapatılır |
| Kayıt silindi, sekme kapanamadı | Silinmiş olarak kalır | Kapatma hatası ayrıca bildirilir; yeniden silme veya kalıcı silme onayı tetiklenmez |

### 5.2 Zorunlu kurallar

- **DEL-01 — Yetenek:** Silme MUST yalnızca güvenli silme entegrasyonu bulunan sağlayıcıda sunulmalı. Doğrudan komut çağrısı da aynı kontrolü uygulamalı.
- **DEL-02 — Onay:** Tekli/toplu silme MUST sayıyı, hedef başlıklarını, geri alınabilirliği ve kapsamı belirten açık onay istemeli. Çocuk oturum/artifact siliniyorsa bu kapsam da açıklanmalı.
- **DEL-03 — Geri alma:** Dosya tabanlı silme MUST önce Trash denemeli; kalıcı silmeye geçiş ayrı onay gerektirmeli. Native veritabanı mutasyonu gibi Trash kullanılamayan işlemler baştan kalıcı olarak onaylanmalı.
- **DEL-04 — Canlı doğrulama:** Silme MUST güncel modeli çözümleyip store sınırını, dosya türünü, symlink durumunu, sağlayıcı kimliğini ve projeyi doğrulamalı. Asenkron keşif/onay sonrası mutasyondan önce yeniden doğrulama yapılmalı. Belirsiz veya değişmiş hedef reddedilmeli.
- **DEL-05 — En küçük birim:** Ortak veritabanı veya proje klasörü MUST NOT sırf bir konuşma siliniyor diye kaldırılmalı. Sağlayıcının ilişki bütünlüğü korunmalı; doğrulanmış konuşma ailesi dışında kardeş kayıtlar, kimlik bilgileri, yapılandırma ve bilinmeyen dosyalar korunmalı.
- **DEL-06 — Sürümler:** Aynı oturumun eski dosya nesilleri yeniden görünmeye neden oluyorsa ilgili nesiller doğrulanarak kaldırılmalı. Çok dosyalı silmenin atomik olmadığı açıkça kabul edilmeli; kısmi hata başarı diye sunulmamalı.
- **DEL-07 — Kimlik:** Otomatik kapatma MUST güncel harness/oturum bağlantısına dayanmalı. Başlık, yakın zaman damgası, aynı cwd veya tek başına PID yeterli değildir. PID yeniden kullanımı, salt okuyan süreçler, tool/subagent ve ortak daemon ayrılmalı.
- **DEL-08 — Belirsizlik:** Canlı kimlik kanıtlanamıyorsa rastgele sekme MUST NOT kapatılmalı. Hedef standartta kullanıcıya bu sınır görünür olmalı; doğrulanmış harici yazıcı varsa güvenli durdurma olmadan silme reddedilmeli. Belirsizlik sessizce “sekme de kapandı” başarısına dönüşmemeli.
- **DEL-09 — İşlem sırası:** Onay → hedef/kimlik doğrulama → yerel kaydı silme → başarılı hedeflerin doğrulanmış sekmelerini kapatma → listeyi yenileme. Onay iptali veya kayıt silme başarısızlığında terminal kapatılmamalı.
- **DEL-10 — Ayrı sonuçlar:** Kayıt silme ve terminal kapatma MUST ayrı sonuçlar olarak tutulmalı. Bir terminal kapanamasa da diğer doğrulanmış eşleşmeler denenmeli.
- **DEL-11 — Yarışlar:** Silme süresince aynı modelde yinelenen silme ve resume MUST engellenmeli. Scope değişimi eski seçimi yeni agent/projeye uygulamamalı.
- **DEL-12 — Toplu seçim:** Select All MUST o anda listelenen agent/location kapsamını seçmeli. Yenileme/başlık değişikliği seçimi kimlikle korumalı; agent/proje/location değişimi temizlemeli. Kısmi hatada yalnızca başarısız hedefler seçili kalmalı.
- **DEL-13 — Yerel kapsam:** Silme MUST harici paylaşımın iptali, bulut geçmişi temizliği veya bağımsız daemon sonlandırma olarak sunulmamalı.
- **DEL-14 — Kapatma anı:** Kimlik keşfi ile kapatma arasında konuşma değişebiliyorsa bağlantı kapatma anında yeniden doğrulanmalı veya sağlayıcı protokolüyle sabitlenmeli. Silinen konuşma ailesindeki alt oturumlar için de aynı kapatma kapsamı uygulanmalı.
- **DEL-15 — Devam eden işlemler:** Başlamış resume ile silme aynı oturum için koordineli olmalı; silinen kayda bekleyen başlatma devam etmemeli. Modal açıkken scope/store değişirse eski onay geçersiz sayılmalı; yeni hedefler için yeniden onay alınmalı.

**Yazıcı yarışı:** Mevcut sil-sonra-kapat sırası, henüz durmamış CLI'ın kaydı yeniden oluşturmasını atomik olarak engellemez. “Silince bir daha dönmez” garantisi için sağlayıcının güvenli durdurma/kilit/mutasyon protokolü gerekir. Böyle bir protokol olmadan sekmeyi önce kapatmak da bedelsiz çözüm değildir: silme başarısız olduğunda kullanıcının çalışan oturumunu kaybettirir. Bu standart mevcut sırayı korur; atomiklik veya uzak süreç sonlandırma garantisi vermez.

## 6. Mevcut destek matrisi

Aşağıdaki tablo uygulama desteğini gösterir; standart uyumluluğu veya gerçek CLI/VS Code üzerinde doğrulanmış başarı sertifikası değildir.

| Harness | Liste / resume | Yerel silme | Silme sonrası terminal eşleme sınırı |
| --- | --- | --- | --- |
| DeepSeek Harness | Var | Var; doğrulanan dosya nesilleri | Resume kimliği; yeni/değiştirilmiş konuşma canlı izlenmiyor |
| OpenCode | Var; SQLite / eski JSON | Var; native ilişkiler / konuşma ailesi | Resume kimliği; yeni/değiştirilmiş konuşma canlı izlenmiyor |
| Claude Code | Var | Var | Resume kimliği; yeni/değiştirilmiş konuşma canlı izlenmiyor |
| Codex | Var | Var | Silmede Linux writable rollout, Windows writable handle + süreç ağacı; keşif yoksa resume kimliği. macOS canlı keşfi yok |
| Pi Agent | Var | Var | Resume kimliği; yeni/değiştirilmiş konuşma canlı izlenmiyor |
| Gemini CLI | Uygulanmamış | Uygulanmamış | Yalnızca manuel terminal kapatma |
| Goose | Uygulanmamış | Uygulanmamış | Yalnızca manuel terminal kapatma |
| Aider | Uygulanmamış | Uygulanmamış | Yalnızca manuel terminal kapatma |
| Oh My Pi | Var | Var | Linux/Windows/macOS breadcrumb; okunamazsa resume kimliği |
| Crush | Uygulanmamış | Uygulanmamış | Yalnızca manuel terminal kapatma |
| Qwen Code | Uygulanmamış | Uygulanmamış | Yalnızca manuel terminal kapatma |
| Grok Build | Var | Var; doğrulanan oturum klasörü | Linux registry + process-start ile yeni/değiştirilmiş kimlik; diğer platformlarda resume kimliği |
| Prime Agent | Var | Var | Resume kimliği; yeni/değiştirilmiş konuşma canlı izlenmiyor |
| Copilot CLI | Uygulanmamış | Uygulanmamış | Yalnızca manuel terminal kapatma |
| Antigravity CLI | Var; SQLite | Uygulanmamış; salt okunur entegrasyon | Yalnızca manuel terminal kapatma |
| Cursor Agent | Uygulanmamış | Uygulanmamış | Yalnızca manuel terminal kapatma |

Bütün 16 harness ortak terminal başlatma/odaklama/kapatma yollarını kullanır. SQLite ve Zstandard okuma host runtime desteğine bağlıdır. Mevcut listeler en çok 100 kayıt döndürür; taramalar sınırlıdır. Terminal kimliği launch metadata'sıyla taşınır; metadata kaybolduğunda süreçten kurtarma Linux'a özgüdür.

### Bilinen uyum açıkları ve uygulama sırası

1. **Önce yanlış sekme riskini kaldır:** HIST-10 ve DEL-07/08 için güncel kimlik bulunamamasını eski resume ID'sinden ayır. CLI içi konuşma değişiminde eski ID yanlış terminale işaret edebilir. Codex canlı keşfi şu anda silmede kullanılır; resume aynı canlı keşfi kullanmaz. OMP breadcrumb okunamadığında eski kimliğe dönebilir. Grok Linux belirsiz kimliği ayrı ele alır.
2. **Silme sonucunu dürüst göster:** Kayıt silindi ama eşleşen sekme bulunamadı/kapatılamadı durumunu ayır. Eşleme bulunamaması, hiçbir yazıcı olmadığına kanıt değildir. Mevcut terminal kapatma hatası bildirimi bu gereksinimin yalnızca bir parçasıdır.
3. **Var olan entegrasyonları tamamla:** Geçmişi olan sağlayıcılarda yeni/switched/reconnected oturumları, direct/shell/profile ve platform farklarıyla doğrula. Antigravity için güvenli native silme imkânını araştır; ortak SQLite dosyasını silmek kabul edilmez.
4. **Sonra geçmiş kapsamını genişlet:** Yedi terminal-only harness için native format/CLI sözleşmesini doğrula; liste/resume'u, ardından güvenli silmeyi ekle. CLI desteği bilinmeden “desteklenmiyor” deme.

Bu sıra bir uygulama önceliğidir; bu belgeyle kod değişikliği veya bu açıkların kapatıldığı iddiası yapılmaz.

Ek güvenlik açıkları **koddan çıkarımdır; bu çalışmada çalıştırılarak yeniden üretilmedi**: terminal eşlemesi silmeden önce alınır, kapatmada güncel konuşma tekrar doğrulanmaz; başlamış resume ile silme ortak işlem kilidi paylaşmaz; ilk modal sonrasında kapsam tekrar kontrol edilmez; OpenCode alt kayıtları silse de terminal keşfi yalnız seçilen parent ID'sini arar. DEL-14/15 bu açıkların hedef davranışını tanımlar. Aynı sağlayıcı/ID farklı store'larda bulunabiliyorsa seçim ve işlem tekilleştirme anahtarları store'u da ayırt etmeli.

## 7. Kabul senaryoları ve tamamlanma ölçütü

Her destek iddiası şu davranışlarla doğrulanmalı. Kalıcı testler kullanıcıya görünür kimlik, veri bütünlüğü ve hata sınırlarını kapsamalı; manifest kopyalarını veya iç uygulama ayrıntılarını tekrar test etmek yeterli değildir.

| Kimlik | Senaryo | Beklenen sonuç |
| --- | --- | --- |
| QA-01 | Aynı harness'ta iki yeni terminal aç; aynı başlığı ver; birini kapat | Yalnızca seçilen terminal kapanır; iki kayıt da korunur |
| QA-02 | Kapalı bir kaydı başka proje aktifken resume et | Kayıtlı proje ve onun ayarları kullanılır; kesin konuşma açılır |
| QA-03 | Aynı kayda art arda ve eşzamanlı resume gönder | Tek terminal/tek CLI başlatma; sonradan doğru terminale odaklama |
| QA-04 | Resume başlatmasını başarısız kıl; tekrar dene | Bekleyen başlatma kilidi temizlenir; sonraki deneme çalışır |
| QA-05 | Yeni konuşma başlat; terminal içinde başka konuşmaya geç; eski kaydı sil/resume et | Yeni konuşma yanlışlıkla kapanmaz veya eski kayıt diye odaklanmaz |
| QA-06 | Kaydı sil; aynı kayda bağlı iki yerel terminal ve ilgisiz üçüncü terminal açık olsun | İki doğrulanmış eşleşme kapanır; ilgisiz terminal açık kalır |
| QA-07 | Onayı iptal et veya dosya silmeyi başarısız kıl | Hedef terminal açık kalır; veri ve seçim sonucu doğru bildirilir |
| QA-08 | Trash başarısız olsun; kalıcı silmeyi reddet/kabul et | Reddedilirse kalıcı mutasyon yok; kabul edilirse hedef yeniden doğrulanır |
| QA-09 | Kayıt silindikten sonra bir terminalin kapanması hata versin | Silme yeniden denenmez; diğer eşleşmeler kapanır; ayrı kapatma hatası görünür |
| QA-10 | Toplu silmede bir hedef değişsin/bozulsun | Diğer geçerli hedefler işlenir; başarısızlar seçili ve hata görünür kalır |
| QA-11 | Listeleme ile silme arasında ID/proje/dosya/symlink değiştir | Yanlış kayıt, store dışı yol ve ortak dosya silinmez |
| QA-12 | Aynı konuşmanın eski nesli veya native child/message/part ilişkileri bulunsun | Bilinen silme birimi temizlenir; kardeş konuşma ve bilinmeyen veri korunur |
| QA-13 | Tarama/onay sürerken agent/proje/location değiştir; geç eski sonuç döndür | Eski sonuç yeni kapsamı doldurmaz; eski seçim yeni kayıtlara uygulanmaz |
| QA-14 | Terminal başlığını değiştir; reload/reconnect yap | Kurtarılabilir kimlikle doğru terminal bulunur; agent yeniden çalıştırılmaz |
| QA-15 | Harici writer, read-only handle, nested agent, reused PID veya ortak daemon kullan | Okuyucu/ilgisiz süreç terminal sahipliği sayılmaz; belirsizlikte yanlış sekme kapanmaz |
| QA-16 | Yerel Sessions listesinde seç, yenile, kapsam değiştir ve toplu sil | Aynı model ve destek kuralları uygulanır; kapsam dışı kayıt silinmez |
| QA-17 | Kaydı dışarıdan oluştur/yeniden adlandır/sil; store'u okunamaz yap | Yenileme doğru değişimi gösterir; okunamama boş geçmiş diye sunulmaz |
| QA-18 | Kimlik keşfi sonrasında, kapatmadan önce konuşmayı değiştir | Başka konuşmaya geçmiş terminal kapanmaz |
| QA-19 | Resume shell integration beklerken aynı kaydı sil | İşlemler koordine olur; silinmiş kayda gecikmiş CLI başlatılmaz |
| QA-20 | Silme modalı açıkken kapsam veya store ayarını değiştir | Eski onayla mutasyon yapılmaz; yeni kapsam yeniden onay gerektirir |
| QA-21 | OpenCode parent ve child ayrı terminallerde açıkken parent'ı sil | Silinen ailedeki doğrulanmış terminaller kapanır; kardeş aile açık kalır |
| QA-22 | Aynı sağlayıcı/ID'yi farklı store'larda kullan | Seçim, resume tekilleştirme ve silme yanlış store'a taşınmaz |

**Bir harness için “tamamlandı” demeden önce:** desteklenen CLI sürümü/store biçimi, host/platform sınırları ve silme birimi belgelenmeli; ilgili davranış regresyonları geçmeli; gerçek CLI ve VS Code/code-server üzerinde etkilenen kullanıcı akışı çalıştırılmalı. Direct/shell/profile, yeni/resume/switched/reconnected kimlik ve Windows/Linux/macOS farkları iddia edilen kapsam ölçüsünde doğrulanmalı. Platform tanımlı stub testleri native host doğrulaması yerine geçmez. Çalıştırılmayan senaryo açıkça **doğrulanmadı** yazılmalı.

## 8. Kod dayanakları ve belge bakımı

- `src/harnesses.ts`: sabit 16 harness registry'si, ayar ve ikon kimlikleri.
- `src/launch.ts`, `src/profiles.ts`, `src/workspaceContext.ts`: ortak başlatma, resume tekilleştirme ve proje/host bağlamı.
- `src/terminalExit.ts`, `media/terminal-launcher.cjs`: direct/profile çıkış politikası, gerçek TTY aktarımı ve hata çıktısının korunması.
- `src/savedSessions.ts`: native store keşfi, tarama, resume argümanları ve silme destek listesi.
- `src/savedSessionsView.ts`: kapsamlı seçim, onay, silme, terminal eşleme ve silmeden sonra kapatma.
- `src/deleteSession.ts`, `src/openCodeDeletion.ts`: dosya/klasör ve OpenCode native silme güvenliği.
- `src/terminalIdentity.ts`, `src/grokSessions.ts`, `src/ompSessionOwner.ts`, `src/windowsSessionProcesses.ts`: kalıcı/canlı kimlik ve writer keşfi.
- `src/agentsView.ts`, `src/sessionsView.ts`: yerel ajan ve açık terminal listeleri.
- `scripts/test.mjs`, `scripts/test-terminal-titles.mjs`: mevcut davranış regresyonlarının ana konumları. Burada listelenmeleri bu çalışma sırasında çalıştırıldıkları anlamına gelmez.

`docs/session-audit.md` geçmiş tarihli inceleme kanıtıdır; güncel destek matrisi yerine kullanılmamalı. Yeni entegrasyonda bu matris ve README birlikte güncellenmeli; geçmiş sürüm notları sonradan güncel davranışmış gibi yeniden yazılmamalı. Bu sözleşme yeni adapter/DI mimarisi gerektirmez; ortak modeller ve mevcut fonksiyon tabanlı kayıt yaklaşımı korunur.
