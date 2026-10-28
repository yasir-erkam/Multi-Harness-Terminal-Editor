# Open Terminals yönetimi — ertelenen plan

Durum: kullanıcı isteğiyle uygulama ertelendi. Bu özellikler 1.1.0 sürümünün parçası değildir.

## Kapsam ve uygulama sırası

1. Native Open Terminals görünümünde **Seç / İptal**, **Tümünü seç**, **Seçilenleri kapat (N)** ekle.
2. **Agent filtresi** ve **proje filtresi** ekle. Filtreler kayıtlı geçmişin kapsamını değiştirmesin. Proje bilgisi doğrulanamayan terminaller ayrı, açık bir seçenek altında gösterilsin; başlıktan proje tahmin edilmesin.
3. Satırdan **Diğerlerini kapat** ekle. Hedef, seçilen terminal hariç o anda filtrede görünen ajan terminalleri olsun; kapsam dışındaki terminallere dokunulmasın.

## Davranış sözleşmesi

- Yalnızca eklentinin tanıdığı ajan terminal nesneleri işleme alınır. Diğer VS Code terminalleri ve kayıtlı konuşmalar korunur.
- Çoklu seçim terminal nesnesine bağlıdır. Aynı başlıklı sekmeler karışmaz; başlık değişikliği seçimi bozmaz.
- Seçim modunda satıra tıklamak terminale odaklanmak yerine seçimi değiştirir. Mod dışında mevcut odaklama davranışı korunur.
- Tümünü seç yalnızca o anki görünür filtre sonuçlarını seçer. Sonradan açılan terminaller otomatik seçilmez.
- Filtre değişince seçim temizlenir. Kapanan terminaller seçimden düşer.
- Toplu kapatmadan önce sayı ve hedef başlıkları gösterilir: çalışan işlemler kesilebilir, kayıtlı geçmiş silinmez.
- Onay verildikten sonra yeni açılan terminaller hedef kümesine eklenmez. Kapanmış veya kapsamı değişmiş hedefler yeniden doğrulanır; onay yeni hedeflere aktarılmaz.
- İptalde hiçbir terminal kapanmaz. Bir kapatma hatası diğer hedefleri engellemez; başarısız hedefler seçili kalır ve hata bildirilir.
- Yinelenen toplu kapatma çağrıları tek işlem/onay üretir. Busy durumu finally içinde temizlenir.
- Diğerlerini kapat komutu hedef terminali korur; aynı filtre ve onay kurallarını uygular.
- Ayarlar, komutlar ve mesajlar İngilizce/Türkçe eşleşen yerelleştirmeler kullanır. VS Code ^1.67 uyumluluğu korunur; yeni checkbox API'si varsa özellik tespiti ve eski host için açık seçim göstergesi kullanılır.

## Kabul senaryoları

- Aynı başlıklı iki terminalden yalnızca seçilen kapanır; yabancı VS Code terminali açık kalır.
- Tümünü seç sonrasında açılan terminal, onay öncesinde açılsa da seçilmez.
- Agent/proje filtresi dışındaki terminaller seçilmez veya kapanmaz; geçmiş kapsamı değişmez.
- Başlık değişimi seçimi korur; terminal kapanması seçimi düşürür; filtre değişimi seçimi temizler.
- Onay iptali bütün terminalleri korur. Kısmi dispose hatasında diğer hedefler denenir ve başarısızlar seçili kalır.
- Diğerlerini kapat yalnızca görünür diğer terminalleri kapatır; tutulan ve kapsam dışı terminaller açık kalır.
- Eski veya doğrudan çağrılan komut girdileri modelde yeniden çözülür; başka nesne/path/PID kapatma otoritesi sayılmaz.
- Gerçek VS Code/code-server yüzeyinde seçme, filtreleme, onay, kapatma ve iptal akışları doğrulanır. Stub testleri görsel doğrulama yerine geçmez.

Uygulama başlamadan önce `src/sessionsView.ts`, `src/terminalIdentity.ts` ve `src/workspaceContext.ts` incelenmeli. Proje filtresi için kalıcı kimliğe proje bilgisinin eklenmesi gerekiyorsa tüm direct/shell/profile/resume ve yeniden bağlanma yolları birlikte güncellenmeli; eski terminallerin bilinmeyen proje durumu açık tutulmalı.
