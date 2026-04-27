"""Trilingual patient-education content for ConsultUro.

Each topic is a dict with:
  id:      stable slug used in URLs
  cover:   hero image URL (800px+ recommended)
  title:   { en, hi, gu }
  summary: { en, hi, gu } — short 1–2 sentence description
  details: { en, hi, gu } — longer multi-paragraph explanation
  steps:   { en: [..], hi: [..], gu: [..] } — numbered actionable steps

The server exposes a localized variant via /api/education?lang=en|hi|gu.
Languages fall back to English when a translation is missing.
"""
from typing import Dict, List, Any

# ---------- Image URLs (Unsplash / Pexels — verified 200 OK) ----------
_IMG_KEGEL = "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&q=80"
_IMG_BLADDER = "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&q=80"
_IMG_WATER = "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=800&q=80"
_IMG_HOSPITAL = "https://images.pexels.com/photos/7108257/pexels-photo-7108257.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_LAB = "https://images.pexels.com/photos/7723391/pexels-photo-7723391.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_KIDNEY = "https://images.pexels.com/photos/18272488/pexels-photo-18272488.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_CONSULT = "https://images.unsplash.com/photo-1666214277730-e9c7e755e5a3?w=800&q=80"
_IMG_DOCTOR = "https://images.pexels.com/photos/8376222/pexels-photo-8376222.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_RECOVERY = "https://images.pexels.com/photos/7088530/pexels-photo-7088530.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_BPH = "https://images.unsplash.com/photo-1638202993928-7267aad84c31?w=800&q=80"
_IMG_ED = "https://images.pexels.com/photos/4586709/pexels-photo-4586709.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_STETHO = "https://images.pexels.com/photos/8376222/pexels-photo-8376222.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_TRAVEL = "https://images.unsplash.com/photo-1503220317375-aaad61436b1b?w=800&q=80"
_IMG_FAMILY = "https://images.unsplash.com/photo-1576671081837-49000212a370?w=800&q=80"
_IMG_TELE = "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&q=80"
_IMG_ANATOMY = "https://images.pexels.com/photos/30133402/pexels-photo-30133402.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_MALE = "https://images.unsplash.com/photo-1768644675767-40b294727e10?w=800&q=80"
_IMG_CANCER = "https://images.unsplash.com/photo-1576086213369-97a306d36557?w=800&q=80"
_IMG_SURGERY_ROOM = "https://images.unsplash.com/photo-1551601651-2a8555f1a136?w=800&q=80"
_IMG_CHILD = "https://images.unsplash.com/photo-1544027993-37dbfe43562a?w=800&q=80"
_IMG_LAPARO = "https://images.pexels.com/photos/7088483/pexels-photo-7088483.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_BLOOD = "https://images.pexels.com/photos/4386467/pexels-photo-4386467.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_NIGHT = "https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?w=800&q=80"
_IMG_HORMONE = "https://images.pexels.com/photos/4226766/pexels-photo-4226766.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_FERTILITY = "https://images.pexels.com/photos/3807733/pexels-photo-3807733.jpeg?auto=compress&cs=tinysrgb&w=1200"
_IMG_SHOCKWAVE = "https://images.pexels.com/photos/4226457/pexels-photo-4226457.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_ROBOT = "https://images.unsplash.com/photo-1579154204601-01588f351e67?w=800&q=80"
_IMG_DIET = "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&q=80"
_IMG_EXERCISE = "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80"

# Condition-specific image variety (added 2026-04 to reduce duplicates):
_IMG_USG_IMAGES = "https://images.pexels.com/photos/6463624/pexels-photo-6463624.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_USG_MONITOR = "https://images.pexels.com/photos/7089623/pexels-photo-7089623.jpeg?auto=compress&cs=tinysrgb&w=800"
_IMG_MICROSCOPE = "https://images.unsplash.com/photo-1526930382372-67bf22c0fce2?auto=format&fit=crop&w=800&q=70"
_IMG_DR_CONSULT = "https://images.unsplash.com/photo-1536064479547-7ee40b74b807?auto=format&fit=crop&w=800&q=70"
_IMG_DR_TESTTUBE = "https://images.unsplash.com/photo-1579165466991-467135ad3110?auto=format&fit=crop&w=800&q=70"
_IMG_SPECIMEN = "https://images.unsplash.com/photo-1584028377143-21f876eb9c1e?auto=format&fit=crop&w=800&q=70"


EDUCATION: List[Dict[str, Any]] = [
    {
        "id": "kegel-exercises",
        "cover": _IMG_KEGEL,
        "title": {
            "en": "Kegel (Pelvic Floor) Exercises",
            "hi": "केगल (पेल्विक फ्लोर) व्यायाम",
            "gu": "કેગલ (પેલ્વિક ફ્લોર) કસરત",
        },
        "summary": {
            "en": "Strengthen pelvic floor muscles to treat urinary leakage and improve sexual health.",
            "hi": "पेशाब के रिसाव को रोकने और यौन स्वास्थ्य सुधारने के लिए पेल्विक मांसपेशियों को मजबूत करें।",
            "gu": "મૂત્ર લીક થવાની સમસ્યા રોકવા અને યૌન આરોગ્ય સુધારવા પેલ્વિક સ્નાયુઓ મજબૂત કરો.",
        },
        "details": {
            "en": (
                "The pelvic-floor is a sling of muscles that support the bladder, uterus and rectum. Weak pelvic muscles are "
                "the commonest cause of stress urinary incontinence in women and post-prostatectomy leakage in men. "
                "Daily Kegel exercises, performed correctly for 6 weeks, cure over 60% of mild-to-moderate cases without surgery. "
                "They also improve erectile rigidity, reduce premature ejaculation and support the pelvic organs through pregnancy and after childbirth. "
                "Consistency matters more than intensity — little and often, every day."
            ),
            "hi": (
                "पेल्विक फ्लोर मांसपेशियों का एक समूह है जो मूत्राशय, गर्भाशय और मलाशय को सहारा देता है। "
                "कमजोर पेल्विक मांसपेशियां महिलाओं में तनाव मूत्र असंयम और पुरुषों में प्रोस्टेट सर्जरी के बाद रिसाव का सबसे सामान्य कारण हैं। "
                "सही तरीके से 6 सप्ताह तक रोज़ केगल व्यायाम करने पर 60% से अधिक हल्के-मध्यम मामलों में बिना सर्जरी के सुधार हो जाता है। "
                "यह स्तंभन शक्ति भी बढ़ाता है और प्रसव के बाद मांसपेशियों को मजबूत करता है।"
            ),
            "gu": (
                "પેલ્વિક ફ્લોર એ સ્નાયુઓનું જૂથ છે જે મૂત્રાશય, ગર્ભાશય અને ગુદામાર્ગને ટેકો આપે છે. "
                "નબળા પેલ્વિક સ્નાયુઓ સ્ત્રીઓમાં તણાવજન્ય મૂત્ર-અસંયમ અને પુરુષોમાં પ્રોસ્ટેટ સર્જરી પછીના લીકનું સૌથી સામાન્ય કારણ છે. "
                "6 અઠવાડિયા સુધી રોજ યોગ્ય રીતે કેગલ કસરત કરવાથી 60% થી વધુ હળવા-મધ્યમ કેસમાં સર્જરી વગર સુધારો થાય છે. "
                "તે ઇરેક્ટાઇલ શક્તિ પણ વધારે છે અને પ્રસૂતિ પછી સ્નાયુઓને મજબૂત બનાવે છે."
            ),
        },
        "steps": {
            "en": [
                "Identify the right muscles: imagine stopping your urine mid-flow — those are the pelvic-floor muscles. (Only to identify, do NOT repeatedly practise while urinating.)",
                "Empty your bladder and sit or lie down comfortably.",
                "Tighten the muscles and hold the contraction for 5 seconds.",
                "Relax for 5 seconds. Build up to 10-second holds with 10-second rests.",
                "Aim for 3 sets of 10 repetitions every day.",
                "Breathe normally — do not hold your breath or squeeze your abdomen, thighs or buttocks.",
                "Visible results typically appear in 4–6 weeks of consistent practice.",
            ],
            "hi": [
                "सही मांसपेशी पहचानें: पेशाब के बीच रोकने का प्रयास कीजिए — यही पेल्विक मांसपेशियां हैं। (केवल पहचानने के लिए, पेशाब करते समय बार-बार न करें।)",
                "मूत्राशय खाली करें और आराम से बैठ या लेट जाएँ।",
                "मांसपेशियों को कसें और 5 सेकंड तक पकड़कर रखें।",
                "5 सेकंड आराम करें। धीरे-धीरे 10 सेकंड तक कसने-छोड़ने की आदत डालें।",
                "रोज़ 10-10 की 3 सेट करें।",
                "सामान्य रूप से साँस लें — पेट, जाँघ या नितंब कसें नहीं।",
                "4–6 हफ्ते नियमित अभ्यास में असर दिखता है।",
            ],
            "gu": [
                "યોગ્ય સ્નાયુ ઓળખો: પેશાબને વચ્ચે રોકવાનો પ્રયાસ કરો — એ જ પેલ્વિક સ્નાયુ છે. (ફક્ત ઓળખવા માટે, પેશાબ વખતે વારંવાર ન કરો.)",
                "મૂત્રાશય ખાલી કરી આરામથી બેસો કે સૂઈ જાવ.",
                "સ્નાયુઓ કડક કરો અને 5 સેકન્ડ પકડી રાખો.",
                "5 સેકન્ડ આરામ કરો. ધીમે-ધીમે 10 સેકન્ડ સુધી વધારો.",
                "દરરોજ 10-10ના 3 સેટ કરો.",
                "સામાન્ય શ્વાસ લો — પેટ, જાંઘ કે નિતંબ કડક ન કરો.",
                "4–6 અઠવાડિયાંની નિયમિત પ્રેક્ટિસ પછી અસર દેખાય છે.",
            ],
        },
    },
    {
        "id": "bladder-training",
        "cover": _IMG_BLADDER,
        "title": {
            "en": "Bladder Training",
            "hi": "मूत्राशय प्रशिक्षण",
            "gu": "મૂત્રાશય તાલીમ",
        },
        "summary": {
            "en": "Retrain your bladder to hold urine longer and reduce urgency and frequency.",
            "hi": "बार-बार और अचानक पेशाब की इच्छा को कम करने के लिए मूत्राशय को नियंत्रित करना सिखाएं।",
            "gu": "વારંવાર અને તાત્કાલિક પેશાબની લાગણી ઘટાડવા માટે મૂત્રાશયને કાબુમાં રાખતાં શીખવો.",
        },
        "details": {
            "en": (
                "Overactive bladder sends false signals of fullness even when only a little urine has collected. "
                "Bladder training works by progressively extending the time between voids, which retrains the bladder-brain "
                "reflex over 6–8 weeks. Combine it with Kegel exercises and reduction of bladder irritants (caffeine, fizzy drinks, "
                "alcohol, artificial sweeteners). Most patients achieve voiding every 3–4 hours — a normal adult pattern — without medication."
            ),
            "hi": (
                "अतिसक्रिय मूत्राशय कम पेशाब जमा होने पर भी भरे होने का झूठा संदेश भेजता है। "
                "मूत्राशय प्रशिक्षण में धीरे-धीरे दो पेशाब के बीच का समय बढ़ाया जाता है, जिससे 6–8 सप्ताह में मूत्राशय-मस्तिष्क का तालमेल सुधरता है। "
                "इसे केगल व्यायाम और कॉफी, कोल्ड-ड्रिंक, शराब तथा कृत्रिम मिठास से परहेज़ के साथ मिलाएँ। अधिकांश रोगी 3–4 घंटे के अंतराल तक पहुँच जाते हैं।"
            ),
            "gu": (
                "અતિસક્રિય મૂત્રાશય થોડું પેશાબ ભરાયા પછી પણ ભરાઈ ગયાનો ખોટો સંદેશ મોકલે છે. "
                "મૂત્રાશય તાલીમમાં ધીરે-ધીરે બે પેશાબ વચ્ચેનો સમય વધારાય છે, જેથી 6–8 અઠવાડિયામાં મૂત્રાશય-મગજનું સંકલન સુધરે છે. "
                "કેગલ કસરત અને કૅફીન, સોફ્ટ-ડ્રિંક, દારૂ તથા આર્ટિફિશિયલ સ્વીટનરથી દૂર રહેવા સાથે જોડો. મોટાભાગના દર્દી 3–4 કલાકના અંતરે પહોંચી જાય છે."
            ),
        },
        "steps": {
            "en": [
                "Keep a bladder diary for 3 days — note each time you urinate and the volume.",
                "From the diary, find your current interval (e.g. every 60 minutes).",
                "Schedule voids at that interval — go even if you do not feel the urge.",
                "Increase the interval by 15 minutes each week until you reach 3–4 hours between voids.",
                "When urgency strikes early, sit down, take slow breaths and do 5 quick Kegels — the urge will pass.",
                "Limit bladder irritants: caffeine, carbonated drinks, alcohol and artificial sweeteners.",
                "Maintain normal fluid intake — restricting fluids concentrates urine and worsens symptoms.",
            ],
            "hi": [
                "3 दिन तक डायरी बनाएँ — हर बार पेशाब का समय और मात्रा लिखें।",
                "डायरी से वर्तमान अंतराल पता करें (जैसे हर 60 मिनट)।",
                "उसी अंतराल पर जाएँ — इच्छा न होने पर भी।",
                "हर सप्ताह अंतराल 15 मिनट बढ़ाएँ जब तक 3–4 घंटे तक न पहुँच जाएँ।",
                "जल्दी इच्छा हो तो बैठें, धीरे साँस लें और 5 बार केगल करें — इच्छा चली जाएगी।",
                "कैफ़ीन, कोल्ड-ड्रिंक, शराब, कृत्रिम मिठास कम करें।",
                "सामान्य मात्रा में पानी पीते रहें — कम पानी से पेशाब गाढ़ा होकर समस्या बढ़ती है।",
            ],
            "gu": [
                "3 દિવસ ડાયરી રાખો — દર વખતે પેશાબનો સમય અને માત્રા નોંધો.",
                "ડાયરીમાંથી હાલનો અંતરાલ શોધો (દા.ત. દર 60 મિનિટે).",
                "એ જ અંતરાલે જાઓ — ઇચ્છા ન થાય તો પણ.",
                "દર અઠવાડિયે 15 મિનિટ વધારો જ્યાં સુધી 3–4 કલાક સુધી ન પહોંચો.",
                "જલ્દી ઇચ્છા થાય તો બેસો, ધીમે શ્વાસ લો અને 5 વાર કેગલ કરો — ઇચ્છા ચાલી જશે.",
                "કૅફીન, સોફ્ટ-ડ્રિંક, દારૂ અને આર્ટિફિશિયલ સ્વીટનર ઘટાડો.",
                "સામાન્ય માત્રામાં પાણી પીઓ — ઓછું પાણી પેશાબ ગાઢું બનાવી તકલીફ વધારે છે.",
            ],
        },
    },
    {
        "id": "fluid-management",
        "cover": _IMG_WATER,
        "title": {
            "en": "Fluid Management for Urology Patients",
            "hi": "मूत्र रोग रोगियों के लिए पानी का सेवन",
            "gu": "યુરોલોજી દર્દીઓ માટે પ્રવાહી વ્યવસ્થાપન",
        },
        "summary": {
            "en": "How much and what to drink to protect kidneys, prevent stones and calm the prostate.",
            "hi": "गुर्दे और प्रोस्टेट की सुरक्षा तथा पथरी से बचाव के लिए कितना और क्या पिएँ।",
            "gu": "કિડની-પ્રોસ્ટેટ સુરક્ષા અને પથરી રોકવા માટે કેટલું અને શું પીવું.",
        },
        "details": {
            "en": (
                "Water is the cheapest, safest urological medicine. Target 2.5–3 litres of plain water a day (unless you have heart or kidney failure). "
                "For stone-formers, the goal is to pass at least 2.5 litres of urine per day — that means drinking 3+ litres in hot climates. "
                "Spread intake across the day, reduce heavily after 6 pm to limit nocturia, and shift the balance toward citrus water (lemon, orange) "
                "to add urinary citrate — a natural stone inhibitor. Coffee, tea and alcohol should each be limited to 2 servings a day."
            ),
            "hi": (
                "पानी यूरोलॉजी की सबसे सस्ती, सुरक्षित दवा है। सामान्य व्यक्ति को रोज़ 2.5–3 लीटर पानी पीना चाहिए (हृदय/गुर्दे की विफलता में चिकित्सक से पूछें)। "
                "पथरी के रोगियों को रोज़ कम-से-कम 2.5 लीटर पेशाब हो — यानी गर्मी में 3+ लीटर पानी। "
                "दिन भर थोड़ा-थोड़ा पिएँ, शाम 6 बजे के बाद घटाएँ, नींबू-संतरे का पानी पथरी बनने से रोकता है। चाय, कॉफी, शराब दिन में 2 बार से अधिक न लें।"
            ),
            "gu": (
                "પાણી યુરોલોજીની સૌથી સસ્તી અને સલામત દવા છે. રોજ 2.5–3 લિટર પાણી પીઓ (હૃદય/કિડની નિષ્ફળતા હોય તો ડૉક્ટરને પૂછો). "
                "પથરી ધરાવતા દર્દીએ રોજ ઓછામાં ઓછું 2.5 લિટર પેશાબ કરવો — એટલે ઉનાળામાં 3+ લિટર પાણી. "
                "દિવસભર થોડું-થોડું પીઓ, સાંજે 6 પછી ઓછું કરો, લીંબુ-સંતરાનું પાણી પથરી થતી અટકાવે છે. ચા, કૉફી, દારૂ દિવસમાં 2થી વધુ વખત ન લેવા."
            ),
        },
        "steps": {
            "en": [
                "Aim for 2.5–3 litres of plain water/day (unless you have heart or kidney failure).",
                "Your urine should be pale straw-coloured; dark urine means you are dehydrated.",
                "Stop fluids 2 hours before bed to reduce night-time urination.",
                "For stone formers: add 1 lemon's juice or a sachet of potassium citrate daily.",
                "Limit coffee/tea to 2 cups/day — they are bladder irritants.",
                "Avoid alcohol and colas if you have urgency or recurrent UTIs.",
            ],
            "hi": [
                "रोज़ 2.5–3 लीटर सादा पानी पिएँ (हृदय/गुर्दे की विफलता में डॉक्टर से पूछें)।",
                "पेशाब हल्के पीले रंग का हो; गहरा पीला मतलब पानी कम है।",
                "सोने से 2 घंटे पहले पानी रोकें — रात की पेशाब कम होगी।",
                "पथरी के रोगी रोज़ 1 नींबू का रस या पोटैशियम-सिट्रेट जोड़ें।",
                "चाय/कॉफी 2 कप से अधिक नहीं — ये मूत्राशय को परेशान करते हैं।",
                "बार-बार UTI या अर्जेंसी हो तो कोल्ड-ड्रिंक और शराब बंद।",
            ],
            "gu": [
                "રોજ 2.5–3 લિટર સાદું પાણી પીઓ (હૃદય/કિડની નિષ્ફળતા હોય તો ડૉક્ટરને પૂછો).",
                "પેશાબ આછા પીળા રંગનું હોવું જોઈએ; ગાઢું પીળું એટલે પાણી ઓછું.",
                "ઊંઘતા પહેલાં 2 કલાક પાણી બંધ — રાત્રે પેશાબ ઘટશે.",
                "પથરીવાળા દર્દી રોજ 1 લીંબુનો રસ કે પોટેશિયમ-સિટ્રેટ ઉમેરે.",
                "ચા/કૉફી 2 કપથી વધારે નહીં — તે મૂત્રાશયને હેરાન કરે છે.",
                "વારંવાર UTI કે અર્જન્સી હોય તો કોલ્ડ-ડ્રિંક-દારૂ બંધ.",
            ],
        },
    },
    # ---- condensed topics: English long-form + translated title/summary ----
    {
        "id": "pre-op-prep",
        "cover": _IMG_HOSPITAL,
        "title": {
            "en": "Preparing for Urology Surgery",
            "hi": "यूरोलॉजी सर्जरी की तैयारी",
            "gu": "યુરોલોજી સર્જરી માટેની તૈયારી",
        },
        "summary": {
            "en": "A complete checklist of what to do in the week leading up to your operation.",
            "hi": "सर्जरी से एक सप्ताह पहले क्या करें — पूरी चेकलिस्ट।",
            "gu": "સર્જરીના એક અઠવાડિયા પહેલાં શું કરવું — સંપૂર્ણ ચેકલિસ્ટ.",
        },
        "details": {
            "en": (
                "Good pre-operative preparation dramatically reduces complications. Bring every prescription and investigation to the pre-op visit so the "
                "anaesthetist can clear you. Stop all blood thinners (Aspirin, Clopidogrel, Warfarin, DOACs) only on the urologist's written advice. "
                "Smokers should stop 2 weeks before — this cuts chest complications and wound infections by half. Follow fasting rules strictly: clear fluids "
                "up to 2 hours, solid food up to 6 hours before. Pack a small bag with medications, chargers, loose clothes and basic toiletries."
            ),
            "hi": (
                "अच्छी तैयारी से जटिलताएँ काफी कम होती हैं। प्री-ऑप विजिट पर सभी दवाइयाँ और रिपोर्ट लाएँ। ब्लड थिनर (एस्पिरिन, क्लोपिडोग्रेल, वार्फरिन, DOAC) केवल यूरोलॉजिस्ट के लिखित निर्देश पर बंद करें। "
                "2 सप्ताह पहले धूम्रपान बंद करें — इससे संक्रमण और फेफड़ों की जटिलताएँ आधी हो जाती हैं। उपवास के नियम सख्ती से मानें: 2 घंटे पहले तक तरल, 6 घंटे पहले तक ठोस भोजन।"
            ),
            "gu": (
                "સારી પૂર્વ-તૈયારીથી જટિલતાઓ ઘટે છે. પ્રી-ઑપ વિઝિટમાં બધી દવાઓ અને રિપોર્ટ લાવો. લોહી પાતળું કરતી દવાઓ (ઍસ્પિરિન, ક્લોપિડોગ્રેલ, વોર્ફેરિન, DOAC) માત્ર યુરોલોજિસ્ટની લેખિત સૂચના પર બંધ કરો. "
                "2 અઠવાડિયા પહેલાં ધૂમ્રપાન બંધ કરો — સંક્રમણ અને ફેફસાંની જટિલતાઓ અડધી થાય છે. ઉપવાસના નિયમો પાળો: 2 કલાક પહેલાં પ્રવાહી, 6 કલાક પહેલાં ઘન ખોરાક બંધ."
            ),
        },
        "steps": {
            "en": [
                "Bring ALL your medications and investigation reports to the pre-op visit.",
                "Inform the team if you are on blood thinners (Aspirin, Clopidogrel, Warfarin, DOACs).",
                "Stop smoking at least 2 weeks before — reduces wound infections and chest complications.",
                "Fasting: clear fluids till 2 hours before, solid food till 6 hours before surgery.",
                "Pack loose comfortable clothes, slippers, and a charger for the hospital stay.",
                "Arrange a family member to stay with you for the first 24 hours post-surgery.",
            ],
            "hi": [
                "प्री-ऑप विजिट पर सभी दवाइयाँ और रिपोर्ट लाएँ।",
                "अगर आप ब्लड थिनर ले रहे हैं (एस्पिरिन, क्लोपिडोग्रेल, वार्फरिन, DOAC) तो बताइए।",
                "कम-से-कम 2 सप्ताह पहले धूम्रपान बंद करें।",
                "उपवास: 2 घंटे पहले तक तरल, 6 घंटे पहले तक ठोस भोजन।",
                "ढीले आरामदायक कपड़े, चप्पल, और चार्जर साथ रखें।",
                "सर्जरी के बाद 24 घंटे साथ रहने वाला परिवार का सदस्य तय करें।",
            ],
            "gu": [
                "પ્રી-ઑપ વિઝિટમાં બધી દવાઓ અને રિપોર્ટ લઈ આવો.",
                "લોહી પાતળું કરતી દવા લેતા હો (ઍસ્પિરિન, ક્લોપિડોગ્રેલ, વોર્ફેરિન, DOAC) તો જણાવો.",
                "ઓછામાં ઓછું 2 અઠવાડિયા પહેલાં ધૂમ્રપાન બંધ કરો.",
                "ઉપવાસ: 2 કલાક પહેલાં સુધી પ્રવાહી, 6 કલાક પહેલાં સુધી ઘન ખોરાક.",
                "ઢીલા-આરામદાયક કપડાં, ચપ્પલ અને ચાર્જર સાથે રાખો.",
                "સર્જરી પછી 24 કલાક માટે પરિવારના સભ્યને સાથે રહેવા નક્કી કરો.",
            ],
        },
    },
    {
        "id": "psa-testing",
        "cover": _IMG_SPECIMEN,
        "title": {
            "en": "Understanding Your PSA Test",
            "hi": "अपना PSA टेस्ट समझें",
            "gu": "તમારો PSA ટેસ્ટ સમજો",
        },
        "summary": {
            "en": "What the numbers mean and when to act — a clear guide to prostate-specific antigen.",
            "hi": "PSA के अंकों का अर्थ और कब इलाज कराएँ — एक स्पष्ट मार्गदर्शिका।",
            "gu": "PSA આંકોનો અર્થ અને ક્યારે ઇલાજ કરાવવો — સ્પષ્ટ માર્ગદર્શન.",
        },
        "details": {
            "en": (
                "PSA (Prostate-Specific Antigen) is a protein produced by prostate cells — both normal and cancerous. "
                "Levels rise with age, an enlarged prostate (BPH), prostatitis, vigorous cycling, ejaculation within 48 hours, and prostate cancer. "
                "A PSA above 4 ng/ml or a sustained annual rise (velocity) of more than 0.75 ng/ml warrants urology review — typically with a multiparametric MRI "
                "and targeted biopsy if indicated. Importantly, a normal PSA does NOT exclude cancer, so still report blood in urine, bone pain or severe urinary symptoms."
            ),
            "hi": (
                "PSA प्रोस्टेट कोशिकाओं द्वारा बनने वाला एक प्रोटीन है — सामान्य और कैंसर दोनों। "
                "उम्र के साथ बढ़ता है; प्रोस्टेट का बढ़ना (BPH), संक्रमण, तेज़ साइकिलिंग, 48 घंटे में स्खलन और कैंसर सभी से बढ़ सकता है। "
                "PSA 4 ng/ml से ऊपर या हर साल 0.75 ng/ml से अधिक बढ़ना यूरोलॉजिस्ट से जाँच की ज़रूरत बताता है — जहाँ उचित हो वहाँ MRI और टार्गेटेड बायोप्सी होती है। "
                "ध्यान दें: सामान्य PSA कैंसर को बाहर नहीं करता।"
            ),
            "gu": (
                "PSA એ પ્રોસ્ટેટ કોષો દ્વારા બનતો પ્રોટીન છે — સામાન્ય અને કૅન્સર બંને માટે. "
                "ઉંમર, પ્રોસ્ટેટ મોટું થવું (BPH), ઇન્ફેક્શન, ઝડપી સાયકલિંગ, 48 કલાકમાં સ્ખલન કે કૅન્સર — કોઈ પણ કારણે PSA વધી શકે છે. "
                "4 ng/ml ઉપર કે દર વર્ષે 0.75થી વધુનો વધારો યુરોલોજિસ્ટ પાસે તપાસ જરૂરી બનાવે છે — MRI અને ટાર્ગેટેડ બાયોપ્સી કરવામાં આવે છે. "
                "સામાન્ય PSA કૅન્સરને બાકાત કરતો નથી."
            ),
        },
        "steps": {
            "en": [
                "PSA is a protein made by the prostate — levels rise with age, BPH, infection and cancer.",
                "All men ≥50 should get an annual PSA (start at 45 with a family history).",
                "Avoid ejaculation, cycling and DRE for 48 hours before the test — they can falsely raise PSA.",
                "PSA > 4 ng/ml or a rapid rise (>0.75 ng/ml/year) needs urology review.",
                "MRI prostate and MRI-targeted biopsy are now preferred to blind biopsies.",
                "A normal PSA does NOT rule out cancer — still report urinary symptoms and blood in urine.",
            ],
            "hi": [
                "PSA प्रोस्टेट द्वारा बना प्रोटीन है — उम्र, BPH, संक्रमण और कैंसर में बढ़ता है।",
                "50+ वर्ष के सभी पुरुष साल में एक बार PSA कराएँ (परिवार में इतिहास हो तो 45 से)।",
                "टेस्ट से 48 घंटे पहले स्खलन, साइकिलिंग और DRE न करें — झूठा बढ़ सकता है।",
                "PSA > 4 ng/ml या सालाना 0.75 से अधिक वृद्धि — यूरोलॉजिस्ट से मिलें।",
                "अब ब्लाइंड बायोप्सी के बजाय MRI व MRI-टार्गेटेड बायोप्सी को वरीयता।",
                "सामान्य PSA का मतलब कैंसर नहीं है — लक्षण हों तो ज़रूर बताइए।",
            ],
            "gu": [
                "PSA પ્રોસ્ટેટ દ્વારા બનતો પ્રોટીન છે — ઉંમર, BPH, ઇન્ફેક્શન અને કૅન્સરમાં વધે.",
                "50+ વર્ષના બધા પુરુષોએ વર્ષે એકવાર PSA કરાવવો (પરિવારમાં હોય તો 45થી).",
                "ટેસ્ટ પહેલાં 48 કલાક સ્ખલન, સાયકલિંગ, DRE ટાળો — ખોટો વધારો થઈ શકે.",
                "PSA > 4 ng/ml કે વાર્ષિક 0.75થી વધુ વધારો — યુરોલોજિસ્ટને મળો.",
                "હવે બ્લાઇન્ડ બાયોપ્સીના બદલે MRI અને MRI-ટાર્ગેટેડ બાયોપ્સી પસંદ કરાય છે.",
                "સામાન્ય PSA એટલે કૅન્સર નથી એવું નહીં — લક્ષણો જણાવવા.",
            ],
        },
    },
    {
        "id": "stone-prevention",
        "cover": _IMG_KIDNEY,
        "title": {
            "en": "Preventing Kidney Stones",
            "hi": "गुर्दे की पथरी की रोकथाम",
            "gu": "કિડની પથરી અટકાવવી",
        },
        "summary": {
            "en": "Lifestyle and dietary changes that cut recurrence by more than 50%.",
            "hi": "जीवनशैली और आहार में बदलाव जो पथरी दोबारा होने को 50% से अधिक घटाते हैं।",
            "gu": "જીવનશૈલી અને આહારમાં ફેરફારો જે પથરી ફરી થવાની તક 50%થી વધુ ઘટાડે છે.",
        },
        "details": {
            "en": (
                "Kidney stones recur in 50% of patients within 10 years if preventive measures are not taken. The cornerstone is "
                "adequate fluid — enough to produce at least 2.5 litres of urine daily. Dietary tweaks are equally important: keep calcium moderate "
                "(do not stop dairy — that actually worsens stones), slash sodium to under 5 g/day, trim animal protein, and add citrus. "
                "Obesity doubles risk, so weight loss matters. For recurrent stoners, a 24-hour urine test guides targeted therapy."
            ),
            "hi": (
                "यदि उपाय न किए जाएँ तो 10 वर्षों में 50% रोगियों में पथरी दोबारा होती है। सबसे महत्वपूर्ण है पर्याप्त पानी — रोज़ कम-से-कम 2.5 लीटर पेशाब होना चाहिए। "
                "आहार में सुधार: कैल्शियम बंद न करें (दूध-दही बंद करने से पथरी और बढ़ती है), नमक 5 ग्राम/दिन से कम, मांस कम, नींबू/संतरा बढ़ाएँ। "
                "मोटापा जोखिम दोगुना करता है। बार-बार पथरी होने पर 24-घंटे का यूरिन टेस्ट सटीक इलाज सुझाता है।"
            ),
            "gu": (
                "ઉપાય ન લેવાય તો 10 વર્ષમાં 50% દર્દીઓને પથરી ફરી થાય છે. સૌથી મહત્વપૂર્ણ છે પૂરતું પાણી — રોજ ઓછામાં ઓછું 2.5 લિટર પેશાબ થવો જોઈએ. "
                "આહાર: કૅલ્શિયમ બંધ ન કરો (દૂધ-દહીં બંધ કરવાથી પથરી વધે છે), મીઠું 5 ગ્રામ/દિવસથી ઓછું, માંસ ઓછું, લીંબુ/સંતરું વધારો. "
                "સ્થૂળતા જોખમ બમણું કરે છે. વારંવાર પથરી થાય તો 24-કલાકનો યુરિન ટેસ્ટ ચોક્કસ ઇલાજ સૂચવે છે."
            ),
        },
        "steps": {
            "en": [
                "Drink enough fluid to pass at least 2.5 litres of urine per day (~3 L intake).",
                "Add half a lemon/lime to 1 L water — citrate inhibits calcium-oxalate crystals.",
                "Moderate calcium: 2 glasses of milk or curd daily — avoid calcium supplements unless prescribed.",
                "Cut salt to <5 g/day — high salt increases urinary calcium loss.",
                "Limit animal protein: small portions of red meat, chicken or fish.",
                "Lose excess weight — obesity doubles stone risk.",
                "Avoid vitamin C mega-doses (>1 g/day) — they convert to oxalate.",
            ],
            "hi": [
                "रोज़ इतना पानी पिएँ कि 2.5 लीटर पेशाब हो (लगभग 3 लीटर सेवन)।",
                "1 लीटर पानी में आधा नींबू मिलाएँ — सिट्रेट पथरी रोकता है।",
                "दूध-दही 2 गिलास रोज़ — कैल्शियम सप्लीमेंट डॉक्टर के बिना न लें।",
                "नमक 5 ग्राम/दिन से कम — ज्यादा नमक कैल्शियम बाहर निकालता है।",
                "मांस-मछली छोटे भाग में खाएँ।",
                "वजन कम करें — मोटापा पथरी का जोखिम दोगुना करता है।",
                "विटामिन-C 1 ग्राम/दिन से अधिक न लें — ऑक्सलेट बनाता है।",
            ],
            "gu": [
                "રોજ એટલું પાણી પીઓ કે 2.5 લિટર પેશાબ થાય (આશરે 3 લિટર સેવન).",
                "1 લિટર પાણીમાં અડધું લીંબુ મિક્સ કરો — સિટ્રેટ પથરી રોકે છે.",
                "દૂધ-દહીં 2 ગ્લાસ રોજ — કૅલ્શિયમ સપ્લિમેન્ટ ડૉક્ટર વિના નહીં.",
                "મીઠું 5 ગ્રામ/દિવસથી ઓછું — વધુ મીઠું કૅલ્શિયમ બહાર કાઢે.",
                "માંસ-માછલી નાના ભાગમાં.",
                "વજન ઘટાડો — સ્થૂળતા પથરીનું જોખમ બમણું કરે.",
                "વિટામિન-C 1 ગ્રામ/દિવસથી વધુ ન લેવું — ઓક્સલેટ બનાવે છે.",
            ],
        },
    },
    {
        "id": "uti-prevention",
        "cover": _IMG_LAB,
        "title": {
            "en": "Preventing Recurrent UTI (Women)",
            "hi": "महिलाओं में बार-बार UTI से बचाव",
            "gu": "સ્ત્રીઓમાં વારંવાર UTI અટકાવવી",
        },
        "summary": {
            "en": "Practical steps to cut recurrent urinary infections — without daily antibiotics.",
            "hi": "रोज़ाना एंटीबायोटिक के बिना बार-बार होने वाले मूत्र संक्रमण को रोकने के व्यावहारिक उपाय।",
            "gu": "રોજની એન્ટિબાયોટિક વિના વારંવાર UTI રોકવાના વ્યવહારિક પગલાં.",
        },
        "details": {
            "en": (
                "Three or more UTIs a year classify as recurrent. The commonest culprit is E. coli from the bowel migrating to the urethra. "
                "Hydration, vaginal hygiene, post-intercourse voiding and D-mannose reduce recurrence without disturbing your microbiome. "
                "Post-menopausal women benefit greatly from local vaginal oestrogen which restores the protective lactobacilli. "
                "Reserve daily prophylactic antibiotics for severe cases only — overuse breeds resistance."
            ),
            "hi": (
                "साल में 3 या अधिक UTI 'रेकरंट' कहलाती हैं। अधिकांश E. coli से होती हैं जो आंत से मूत्रमार्ग तक पहुँच जाते हैं। "
                "पानी, सफ़ाई, सहवास के बाद पेशाब और D-mannose बिना माइक्रोबायोम को बिगाड़े बचाव करते हैं। "
                "रजोनिवृत्ति के बाद स्थानीय योनि-एस्ट्रोजन बहुत फायदेमंद। दैनिक एंटीबायोटिक केवल गंभीर मामलों में रखें — अति-उपयोग प्रतिरोध पैदा करता है।"
            ),
            "gu": (
                "વર્ષમાં 3 કે વધુ UTI થાય તો 'રિકરન્ટ' કહેવાય. સામાન્ય કારણ આંતરડામાંથી E. coli મૂત્રમાર્ગ સુધી પહોંચવું છે. "
                "પાણી, સફાઈ, સંભોગ પછી પેશાબ અને D-mannose સારું કામ કરે છે. "
                "મેનોપોઝ પછીની સ્ત્રીઓ માટે સ્થાનિક વજાઇનલ ઇસ્ટ્રોજન ઘણું અસરકારક. દૈનિક એન્ટિબાયોટિક માત્ર ગંભીર કેસમાં — વધુ પડતો ઉપયોગ પ્રતિરોધ પેદા કરે છે."
            ),
        },
        "steps": {
            "en": [
                "Drink 2 L water/day — consistent hydration flushes bacteria.",
                "Wipe front to back after using the toilet.",
                "Empty the bladder within 15 minutes after intercourse.",
                "Avoid douches, scented soaps and spermicides — they disturb vaginal flora.",
                "Consider D-mannose 2 g/day — evidence for E. coli prevention.",
                "Vaginal oestrogen cream for post-menopausal women (with gynaec input).",
                "Discuss low-dose prophylactic antibiotics only if ≥3 UTIs/year despite above.",
            ],
            "hi": [
                "रोज़ 2 लीटर पानी पिएँ।",
                "शौच के बाद आगे से पीछे की ओर पोंछें।",
                "सहवास के 15 मिनट के भीतर पेशाब कर लें।",
                "सुगंधित साबुन और स्परमिसाइड से बचें।",
                "D-mannose 2 ग्राम/दिन E. coli की रोकथाम में लाभकारी।",
                "रजोनिवृत्ति के बाद स्थानीय एस्ट्रोजन क्रीम (स्त्री रोग विशेषज्ञ की सलाह से)।",
                "यदि उपायों के बावजूद ≥3 UTI/वर्ष हो तो कम-मात्रा प्रोफ़ाइलेक्सिस पर चर्चा।",
            ],
            "gu": [
                "રોજ 2 લિટર પાણી પીઓ.",
                "શૌચ પછી આગળથી પાછળ તરફ લૂછવું.",
                "સંભોગ પછી 15 મિનિટમાં પેશાબ કરો.",
                "સુગંધિત સાબુ અને સ્પર્મિસાઇડથી દૂર રહો.",
                "D-mannose 2 ગ્રામ/દિવસ E. coli રોકવામાં મદદ કરે.",
                "મેનોપોઝ પછી સ્થાનિક ઇસ્ટ્રોજન ક્રીમ (સ્ત્રીરોગ નિષ્ણાતની સલાહથી).",
                "ઉપાય છતાં ≥3 UTI/વર્ષ થાય તો ઓછી-માત્રા પ્રોફિલૅક્સિસ અંગે ચર્ચા.",
            ],
        },
    },
    {
        "id": "post-surgery-care",
        "cover": _IMG_RECOVERY,
        "title": {
            "en": "Home Recovery After Urology Surgery",
            "hi": "यूरोलॉजी सर्जरी के बाद घर पर ठीक होना",
            "gu": "યુરોલોજી સર્જરી પછી ઘરે રિકવરી",
        },
        "summary": {
            "en": "Dos and don'ts for a smooth recovery — from day 1 to 4 weeks.",
            "hi": "सरल रिकवरी के लिए क्या करें-क्या न करें — पहले दिन से 4 सप्ताह तक।",
            "gu": "સરળ રિકવરી માટે શું કરવું–શું ટાળવું — પ્રથમ દિવસથી 4 અઠવાડિયા સુધી.",
        },
        "details": {
            "en": (
                "The first 48 hours determine your recovery trajectory. Early walking prevents clots and chest infections. "
                "Hydration keeps the urinary stream clear and prevents catheter blockage. Finish every prescribed antibiotic course. "
                "Mild haematuria up to 2 weeks after stone or prostate surgery is normal. Call the clinic immediately for fever, "
                "clot retention, inability to pass urine, severe pain or calf swelling — these can indicate UTI, bleeding, DVT or retention."
            ),
            "hi": (
                "पहले 48 घंटे आपकी रिकवरी की दिशा तय करते हैं। जल्दी चलना-फिरना रक्त-थक्के और फेफड़ों के संक्रमण को रोकता है। "
                "पानी पर्याप्त पिएँ, कैथेटर ब्लॉक नहीं होगा। एंटीबायोटिक का कोर्स पूरा करें। "
                "पथरी/प्रोस्टेट सर्जरी के बाद 2 सप्ताह तक हल्का खून आना सामान्य है। बुखार, क्लॉट रिटेंशन, पेशाब न आना, तेज़ दर्द, या पैर सूजना हो तो तुरंत क्लिनिक से संपर्क करें।"
            ),
            "gu": (
                "પ્રથમ 48 કલાક તમારી રિકવરીની દિશા નક્કી કરે છે. વહેલું ચાલવું ગાંઠ અને ફેફસાંના ઇન્ફેક્શનને રોકે છે. "
                "પૂરતું પાણી પીઓ, કૅથેટર બ્લૉક નહીં થાય. એન્ટિબાયોટિકનો આખો કોર્સ પૂરો કરો. "
                "પથરી/પ્રોસ્ટેટ સર્જરી પછી 2 અઠવાડિયા સુધી હળવું લોહી આવવું સામાન્ય છે. તાવ, ક્લૉટ-રિટેન્શન, પેશાબ ન થાય, તીવ્ર દુખાવો કે પગ સૂજવા — તરત ક્લિનિક ફોન કરો."
            ),
        },
        "steps": {
            "en": [
                "Walk short distances from day 1 — it prevents chest infections and clots.",
                "Drink 2–3 L water/day unless the surgeon advises fluid restriction.",
                "Take prescribed antibiotics for the full course; continue alpha-blockers until reviewed.",
                "Avoid heavy lifting (>5 kg), cycling and bike pillion for 4 weeks.",
                "Expect mild blood in urine for up to 2 weeks after stone / prostate surgery.",
                "Resume gentle sexual activity only after the follow-up review.",
                "Call the clinic immediately if you have fever, clot retention or inability to pass urine.",
            ],
            "hi": [
                "पहले दिन से छोटी दूरी चलें — थक्के और संक्रमण नहीं होंगे।",
                "रोज़ 2–3 लीटर पानी (सर्जन ने मना न किया हो)।",
                "एंटीबायोटिक का पूरा कोर्स; अल्फा-ब्लॉकर समीक्षा तक जारी।",
                "4 सप्ताह तक भारी सामान (>5 kg), साइकिलिंग, बाइक पीछे न बैठें।",
                "पथरी/प्रोस्टेट सर्जरी के बाद 2 सप्ताह तक हल्का खून सामान्य।",
                "फॉलो-अप के बाद ही यौन गतिविधि शुरू करें।",
                "बुखार, क्लॉट, पेशाब न आने पर तुरंत क्लिनिक संपर्क।",
            ],
            "gu": [
                "પ્રથમ દિવસથી ટૂંકી અંતરે ચાલો — ગાંઠ-ઇન્ફેક્શન અટકે.",
                "રોજ 2–3 લિટર પાણી (સર્જને ના પાડી ન હોય તો).",
                "એન્ટિબાયોટિકનો આખો કોર્સ; આલ્ફા-બ્લૉકર રિવ્યૂ સુધી ચાલુ.",
                "4 અઠવાડિયા સુધી ભારે વસ્તુ (>5 kg), સાયકલિંગ, બાઇક પાછળ નહીં.",
                "પથરી/પ્રોસ્ટેટ સર્જરી પછી 2 અઠવાડિયા હળવું લોહી સામાન્ય.",
                "ફોલો-અપ પછી જ જાતીય પ્રવૃત્તિ.",
                "તાવ, ક્લૉટ, પેશાબ બંધ થાય તો તરત ક્લિનિક કૉલ.",
            ],
        },
    },
    {
        "id": "bph-lifestyle",
        "cover": _IMG_BPH,
        "title": {
            "en": "Living with BPH (Enlarged Prostate)",
            "hi": "BPH (प्रोस्टेट वृद्धि) के साथ जीना",
            "gu": "BPH (પ્રોસ્ટેટ મોટું થવું) સાથે જીવવું",
        },
        "summary": {
            "en": "Daily habits that ease the urinary symptoms of an enlarged prostate.",
            "hi": "बढ़े प्रोस्टेट के पेशाब संबंधी लक्षणों को कम करने वाली आदतें।",
            "gu": "મોટા પ્રોસ્ટેટના પેશાબ સંબંધી લક્ષણો ઘટાડતી દૈનિક ટેવો.",
        },
        "details": {
            "en": (
                "BPH symptoms are not just about the prostate size — the muscle tone, bladder function and lifestyle all contribute. "
                "Simple changes can reduce the IPSS score by 4–6 points within a month. Double-voiding empties the bladder more completely. "
                "Shift the fluid-load to the first half of the day so you sleep undisturbed. Avoid decongestants containing pseudoephedrine — "
                "they tighten the bladder neck and cause retention. Track your IPSS every 3 months using the app."
            ),
            "hi": (
                "BPH लक्षण केवल आकार का मामला नहीं — मांसपेशियों की टोन, मूत्राशय का काम और जीवनशैली सभी भूमिका निभाते हैं। "
                "कुछ छोटे बदलाव एक महीने में IPSS 4–6 अंक तक घटा सकते हैं। डबल-वॉइडिंग से मूत्राशय अधिक खाली होता है। "
                "दिन के पहले हिस्से में पानी अधिक, शाम में कम। सूडोएफेड्रिन वाली सर्दी की दवाइयों से बचें — ये पेशाब रोक देती हैं।"
            ),
            "gu": (
                "BPHના લક્ષણો માત્ર કદ પર આધારિત નથી — સ્નાયુઓ, મૂત્રાશય અને જીવનશૈલી બધા ભાગ ભજવે છે. "
                "નાના ફેરફારથી એક મહિનામાં IPSS 4–6 પોઇન્ટ ઘટી શકે. ડબલ-વૉઇડિંગથી મૂત્રાશય વધુ ખાલી થાય. "
                "દિવસના પહેલા ભાગમાં પાણી વધુ, સાંજે ઓછું. સ્યુડોએફેડ્રિનવાળી શરદીની દવાઓથી દૂર રહો — પેશાબ અટકી શકે છે."
            ),
        },
        "steps": {
            "en": [
                "Split fluid intake — big glass in the morning, small sips after 6 pm.",
                "Limit caffeine, alcohol, carbonated drinks and heavy curries in the evening.",
                "Urinate twice (double-voiding) — sit and relax for 30 seconds, then try again.",
                "Avoid medicines that worsen retention: cold remedies with pseudoephedrine, some antihistamines.",
                "Take alpha-blockers at night (dizziness risk — avoid driving for first dose).",
                "Take the IPSS questionnaire in the Tools tab every 3 months to track progress.",
            ],
            "hi": [
                "सुबह अधिक पानी, शाम 6 के बाद कम।",
                "शाम में चाय-कॉफी, शराब, सोडा और मसालेदार खाना कम।",
                "डबल-वॉइडिंग — 30 सेकंड आराम के बाद फिर पेशाब करें।",
                "सूडोएफेड्रिन वाली सर्दी की दवा और कुछ एंटीहिस्टामिन से बचें।",
                "अल्फा-ब्लॉकर रात में (चक्कर आ सकते हैं — पहली डोज़ पर गाड़ी न चलाएँ)।",
                "Tools टैब में हर 3 महीने IPSS प्रश्नावली भरें।",
            ],
            "gu": [
                "સવારે વધુ પાણી, સાંજ 6 પછી ઓછું.",
                "સાંજે ચા-કૉફી, દારૂ, સોડા અને તીખું ખોરાક ઓછું.",
                "ડબલ-વૉઇડિંગ — 30 સેકન્ડ આરામ પછી ફરી પેશાબ કરો.",
                "સ્યુડોએફેડ્રિનવાળી શરદીની દવા અને કેટલીક એન્ટિહિસ્ટામીનથી દૂર રહો.",
                "આલ્ફા-બ્લૉકર રાત્રે (ચક્કર આવી શકે — પહેલી માત્રા પછી ગાડી ન ચલાવો).",
                "Tools ટૅબમાં દર 3 મહિને IPSS પ્રશ્નાવલિ ભરો.",
            ],
        },
    },
    {
        "id": "ed-overview",
        "cover": _IMG_ED,
        "title": {
            "en": "Erectile Dysfunction — First Steps",
            "hi": "नपुंसकता — पहले कदम",
            "gu": "ઇરેક્ટાઇલ ડિસફંક્શન — પ્રથમ પગલાં",
        },
        "summary": {
            "en": "Check your heart, lifestyle and hormones before reaching for pills.",
            "hi": "गोली लेने से पहले हृदय, जीवनशैली और हार्मोन की जाँच कराइए।",
            "gu": "ગોળી લેતા પહેલાં હૃદય, જીવનશૈલી અને હોર્મોનની તપાસ કરાવો.",
        },
        "details": {
            "en": (
                "Erectile dysfunction in a man under 60 is often the earliest warning of vascular disease — preceding heart attack by "
                "3–5 years. Get a comprehensive cardiac screen first: blood pressure, fasting glucose, lipid profile and possibly an ECG. "
                "Forty minutes of brisk exercise 5 days a week is the single most effective non-drug therapy. Optimise sleep, stop smoking, "
                "cap alcohol, and get a morning testosterone if libido is low. PDE5 inhibitors (sildenafil, tadalafil) are safe and effective "
                "for most men; newer options include vacuum devices, injections, shockwave therapy and implants."
            ),
            "hi": (
                "60 से कम उम्र में ED कई बार हृदय रोग की पहली चेतावनी होती है — दिल के दौरे से 3–5 साल पहले। "
                "सबसे पहले ब्लड प्रेशर, शुगर, लिपिड और ECG कराएँ। सप्ताह में 5 दिन 40 मिनट चलना/दौड़ना सबसे प्रभावी गैर-दवा उपचार है। "
                "नींद सुधारें, धूम्रपान बंद, शराब सीमित, और सुबह का टेस्टोस्टेरोन चेक करें। सिल्डेनाफिल/टाडालाफिल जैसी गोलियाँ सुरक्षित हैं।"
            ),
            "gu": (
                "60થી ઓછી ઉંમરે ED ઘણી વાર હૃદયરોગની પહેલી ચેતવણી હોય છે — હાર્ટ ઍટૅકથી 3–5 વર્ષ પહેલાં. "
                "પહેલાં BP, શુગર, લિપિડ અને ECG કરાવો. અઠવાડિયામાં 5 દિવસ 40 મિનિટ ચાલવું એ સૌથી અસરકારક દવા-મુક્ત ઉપચાર છે. "
                "ઊંઘ સુધારો, ધૂમ્રપાન બંધ, દારૂ મર્યાદિત, સવારનો ટેસ્ટોસ્ટેરોન ચકાસો. સિલ્ડેનાફિલ/ટાડાલાફિલ જેવી ગોળીઓ સલામત છે."
            ),
        },
        "steps": {
            "en": [
                "ED is often the first sign of vascular disease — get a cardiac check, BP and fasting sugar.",
                "Walk or jog 40 min daily, 5 days a week — the single best non-drug therapy.",
                "Stop smoking and cap alcohol to 2 standard drinks or less.",
                "Sleep 7–8 hours — most testosterone is produced during deep sleep.",
                "Check morning total testosterone, prolactin and fasting sugar.",
                "PDE5 inhibitors (sildenafil, tadalafil) work best taken on an empty stomach.",
                "Book a consultation if ED persists >3 months — we have non-pill options too.",
            ],
            "hi": [
                "ED अक्सर हृदय रोग का पहला संकेत — हृदय जाँच, BP, फास्टिंग शुगर कराएँ।",
                "5 दिन/सप्ताह 40 मिनट चलें/दौड़ें — सबसे अच्छा गैर-दवा इलाज।",
                "धूम्रपान बंद; शराब 2 पेग से कम।",
                "7–8 घंटे नींद — गहरी नींद में टेस्टोस्टेरोन बनता है।",
                "सुबह का टोटल टेस्टोस्टेरोन, प्रोलैक्टिन और फास्टिंग शुगर कराएँ।",
                "सिल्डेनाफिल/टाडालाफिल खाली पेट सबसे असरदार।",
                "3 महीने से ED हो तो परामर्श लें — गोली के अलावा भी विकल्प हैं।",
            ],
            "gu": [
                "ED ઘણી વાર હૃદયરોગની પહેલી નિશાની — હૃદય તપાસ, BP, ફાસ્ટિંગ શુગર કરાવો.",
                "5 દિવસ/અઠવાડિયે 40 મિનિટ ચાલો/દોડો — સૌથી સારો દવા વગરનો ઉપચાર.",
                "ધૂમ્રપાન બંધ; દારૂ 2 પેગથી ઓછું.",
                "7–8 કલાક ઊંઘ — ઊંડી ઊંઘમાં ટેસ્ટોસ્ટેરોન બને છે.",
                "સવારનું ટોટલ ટેસ્ટોસ્ટેરોન, પ્રોલેક્ટિન અને ફાસ્ટિંગ શુગર.",
                "સિલ્ડેનાફિલ/ટાડાલાફિલ ખાલી પેટે સૌથી અસરકારક.",
                "3 મહિનાથી ED હોય તો પરામર્શ લો — ગોળી ઉપરાંત પણ વિકલ્પો છે.",
            ],
        },
    },
    {
        "id": "catheter-care",
        "cover": _IMG_RECOVERY,
        "title": {
            "en": "Foley Catheter Home Care",
            "hi": "फ़ोले कैथेटर की घरेलू देखभाल",
            "gu": "ફૉલી કૅથેટરની ઘરેલું સંભાળ",
        },
        "summary": {
            "en": "Keeping your catheter clean, functional and infection-free.",
            "hi": "कैथेटर को साफ, कार्यशील और संक्रमण-मुक्त रखें।",
            "gu": "કૅથેટરને સ્વચ્છ, કાર્યરત અને ઇન્ફેક્શન-મુક્ત રાખો.",
        },
        "details": {
            "en": (
                "A Foley catheter is a rubber tube placed in the bladder to drain urine when you cannot. Catheter-related UTIs are the commonest hospital-"
                "acquired infection — simple hand-washing before handling the catheter cuts this risk by 70%. Always keep the drainage bag below bladder level. "
                "Encrustation is the other enemy: dilute urine by drinking 2–3 L of water, and change the leg bag weekly."
            ),
            "hi": (
                "फ़ोले कैथेटर एक रबर ट्यूब है जो मूत्राशय से पेशाब निकालती है। अस्पताल में होने वाला सबसे आम संक्रमण कैथेटर-UTI है — केवल कैथेटर छूने से पहले हाथ धोने से जोखिम 70% कम हो जाता है। "
                "बैग को हमेशा मूत्राशय से नीचे रखें। 2–3 लीटर पानी पीकर पेशाब पतला रखें; लेग बैग सप्ताह में बदलें।"
            ),
            "gu": (
                "ફૉલી કૅથેટર એ રબરની ટ્યૂબ છે જે મૂત્રાશયમાંથી પેશાબ કાઢે છે. હૉસ્પિટલમાં સૌથી સામાન્ય સંક્રમણ કૅથેટર-UTI છે — કૅથેટર હાથમાં લેતા પહેલાં હાથ ધોવાથી જોખમ 70% ઘટે. "
                "બૅગ હંમેશાં મૂત્રાશયથી નીચે. 2–3 લિટર પાણી પી પેશાબ પાતળું રાખો; લેગ-બૅગ અઠવાડિયે બદલો."
            ),
        },
        "steps": {
            "en": [
                "Wash hands with soap before handling the catheter or bag.",
                "Clean the catheter at the urethral meatus twice daily with plain soap & water.",
                "Keep the drainage bag below bladder level at all times — this prevents reflux.",
                "Empty the bag when it is 2/3 full to avoid traction on the urethra.",
                "Drink 2–3 L water/day unless restricted — dilute urine prevents encrustation.",
                "Report at once: no urine drainage for >2 hours, fever, blood clots, severe pain.",
                "Change the leg bag weekly and the large bag at the clinic every 2–4 weeks.",
            ],
            "hi": [
                "कैथेटर/बैग छूने से पहले साबुन से हाथ धोएँ।",
                "दिन में 2 बार साबुन-पानी से कैथेटर के पास सफाई।",
                "बैग हमेशा मूत्राशय से नीचे रखें — रिफ़्लक्स नहीं होगा।",
                "बैग 2/3 भरा होने पर खाली करें।",
                "2–3 लीटर पानी — पेशाब पतला होगा, जमाव नहीं।",
                "2 घंटे से पेशाब न आए, बुखार, क्लॉट, तेज़ दर्द — तुरंत संपर्क करें।",
                "लेग बैग हर सप्ताह बदलें, बड़ा बैग 2–4 सप्ताह में क्लिनिक पर।",
            ],
            "gu": [
                "કૅથેટર/બૅગ સ્પર્શતા પહેલાં સાબુથી હાથ ધોવા.",
                "દિવસે 2 વાર સાબુ-પાણીથી કૅથેટર પાસે સફાઈ.",
                "બૅગ હંમેશાં મૂત્રાશયથી નીચે રાખો — રીફ્લક્સ ન થાય.",
                "બૅગ 2/3 ભરાય ત્યારે ખાલી કરો.",
                "2–3 લિટર પાણી — પેશાબ પાતળું, જમાવ નહીં.",
                "2 કલાકથી પેશાબ ન આવે, તાવ, ક્લૉટ, તીવ્ર દુખાવો — તરત સંપર્ક.",
                "લેગ-બૅગ દર અઠવાડિયે, મોટી બૅગ 2–4 અઠવાડિયે ક્લિનિકમાં.",
            ],
        },
    },
    {
        "id": "dj-stent-care",
        "cover": _IMG_KIDNEY,
        "title": {
            "en": "Living with a DJ (Ureteric) Stent",
            "hi": "DJ (मूत्रवाहिनी) स्टेंट के साथ जीना",
            "gu": "DJ (યુરેટરિક) સ્ટેન્ટ સાથે જીવવું",
        },
        "summary": {
            "en": "What to expect, what to avoid, and when the stent must come out.",
            "hi": "क्या अपेक्षा करें, क्या न करें और स्टेंट कब निकलवाना चाहिए।",
            "gu": "શું અપેક્ષા રાખવી, શું ટાળવું અને સ્ટેન્ટ ક્યારે કાઢવું.",
        },
        "details": {
            "en": (
                "A DJ stent is a soft silicone tube placed between your kidney and bladder after RIRS/URS. It prevents urine blockage while the ureter "
                "heals. Most patients feel flank discomfort during urination, mild urgency and pink urine — all expected. A stent is ALWAYS temporary — "
                "forgetting it in place leads to encrustation and a major complication. Always book the removal appointment within 2–4 weeks."
            ),
            "hi": (
                "DJ स्टेंट एक नरम सिलिकॉन ट्यूब है जो गुर्दे और मूत्राशय के बीच रखी जाती है (RIRS/URS के बाद)। यह मूत्रवाहिनी के ठीक होने तक रुकावट नहीं बनने देती। "
                "पेशाब के समय कमर में हल्का दर्द, मूत्र-इच्छा और गुलाबी पेशाब सामान्य है। स्टेंट हमेशा अस्थायी होता है — भूल जाने पर एनक्रस्टेशन बड़ी जटिलता है। 2–4 सप्ताह में निकलवाएँ।"
            ),
            "gu": (
                "DJ સ્ટેન્ટ એ નરમ સિલિકોન ટ્યૂબ છે જે કિડની-મૂત્રાશય વચ્ચે મુકાય છે (RIRS/URS પછી). મૂત્રવાહિની રુઝાય ત્યાં સુધી અવરોધ અટકાવે. "
                "પેશાબ વખતે કમરમાં હળવો દુખાવો, અર્જન્સી અને ગુલાબી પેશાબ સામાન્ય. સ્ટેન્ટ હંમેશાં અસ્થાયી — ભૂલી ગયાં તો એન્ક્રસ્ટેશન મોટી તકલીફ. 2–4 અઠવાડિયામાં કાઢવો."
            ),
        },
        "steps": {
            "en": [
                "A DJ stent keeps your ureter open after URS / RIRS — it is a temporary soft tube.",
                "Flank pain on urination and urgency are common — they improve with fluids and painkillers.",
                "Drink 2–3 L water a day; avoid heavy gym workouts for the first 2 weeks.",
                "Pink urine and mild burning are expected; heavy clots or high fever are NOT — call us.",
                "A stent is ALWAYS temporary. Book the removal appointment (usually 2–4 weeks).",
                "Never delay stent removal — an encrusted stent is a serious complication.",
            ],
            "hi": [
                "DJ स्टेंट मूत्रवाहिनी खुली रखता है — अस्थायी नरम ट्यूब है।",
                "पेशाब के समय कमर में दर्द और इच्छा सामान्य — पानी व दर्द निवारक से घटते हैं।",
                "रोज़ 2–3 लीटर पानी; पहले 2 सप्ताह भारी व्यायाम न करें।",
                "गुलाबी पेशाब और हल्की जलन सामान्य; बड़े क्लॉट या तेज़ बुखार पर तुरंत संपर्क।",
                "स्टेंट हमेशा अस्थायी — निकलवाने का अपॉइंटमेंट तय करें (2–4 सप्ताह)।",
                "देरी न करें — एनक्रस्टेड स्टेंट गंभीर जटिलता है।",
            ],
            "gu": [
                "DJ સ્ટેન્ટ મૂત્રવાહિની ખુલ્લી રાખે — અસ્થાયી નરમ ટ્યૂબ.",
                "પેશાબ વખતે કમરમાં દુખાવો અને અર્જન્સી સામાન્ય — પાણી અને દુખાવાની દવાથી ઘટે.",
                "રોજ 2–3 લિટર પાણી; પ્રથમ 2 અઠવાડિયે ભારે કસરત નહીં.",
                "ગુલાબી પેશાબ-હળવી બળતરા સામાન્ય; મોટા ક્લૉટ કે ઊંચો તાવ હોય તો તરત સંપર્ક.",
                "સ્ટેન્ટ હંમેશાં અસ્થાયી — કાઢવા માટે એપોઇન્ટમેન્ટ (2–4 અઠવાડિયે).",
                "મોડું ન કરો — એન્ક્રસ્ટેડ સ્ટેન્ટ ગંભીર જટિલતા.",
            ],
        },
    },
    {
        "id": "travel-kidney-stones",
        "cover": _IMG_TRAVEL,
        "title": {
            "en": "Travelling with Kidney Stones",
            "hi": "पथरी के साथ यात्रा",
            "gu": "પથરી સાથે મુસાફરી",
        },
        "summary": {
            "en": "Tips so a stone attack doesn't ruin your trip.",
            "hi": "पथरी का दौरा आपकी यात्रा न बिगाड़े — ज़रूरी सुझाव।",
            "gu": "પથરીનો હુમલો તમારી મુસાફરી ન બગાડે — ઉપયોગી સૂચનો.",
        },
        "details": {
            "en": (
                "Air travel, dehydration and spicy food combine to trigger stone attacks — especially on long-haul trips. Carry a letter from your urologist "
                "with diagnosis, allergies, medications and a summary of previous interventions. Pack a week's extra supply of tamsulosin, painkillers and "
                "anti-nausea medicines. If you develop an attack abroad, a CT/ultrasound followed by DJ stenting will usually let you continue travel; "
                "definitive stone removal can wait for your return."
            ),
            "hi": (
                "लंबी उड़ान, कम पानी और मसालेदार खाना पथरी के दौरे को ट्रिगर करते हैं। अपने यूरोलॉजिस्ट से एक पत्र लें जिसमें निदान, दवाइयाँ, एलर्जी और पिछली सर्जरी लिखी हो। "
                "एक सप्ताह की अतिरिक्त तमसुलोसिन, दर्द-निवारक और एंटी-नॉज़िया दवा साथ रखें। यदि विदेश में हमला हो तो CT/अल्ट्रासाउंड और DJ स्टेंट से आप सफ़र जारी रख सकते हैं — अंतिम इलाज वापसी पर।"
            ),
            "gu": (
                "લાંબી ઉડાન, ઓછું પાણી અને તીખું ખોરાક પથરીના હુમલાને ઉશ્કેરે છે. તમારા યુરોલોજિસ્ટ પાસેથી એક પત્ર લો જેમાં નિદાન, દવાઓ, એલર્જી અને પહેલાંની સર્જરી હોય. "
                "અઠવાડિયાની વધારાની તમસુલોસિન, દુખાવાની દવા અને એન્ટિ-નૉઝિયા સાથે રાખો. વિદેશમાં હુમલો થાય તો CT/અલ્ટ્રાસાઉન્ડ પછી DJ સ્ટેન્ટ મૂકાવી મુસાફરી ચાલુ રાખી શકાય; અંતિમ ઇલાજ પાછા આવ્યા પછી."
            ),
        },
        "steps": {
            "en": [
                "Carry a letter from your urologist listing diagnosis and medications.",
                "Pack a week's extra supply of painkillers, anti-nausea and tamsulosin.",
                "Identify the nearest emergency room at your destination (save in your phone).",
                "Keep hydrated on flights — one cup of water per hour of flight.",
                "Avoid alcohol, colas and salted snacks on the plane.",
                "If a stone attack strikes mid-travel, CT/ultrasound + DJ stent usually lets you continue travel — then complete treatment back home.",
            ],
            "hi": [
                "निदान व दवाइयों की सूची वाला यूरोलॉजिस्ट का पत्र साथ रखें।",
                "एक सप्ताह की अतिरिक्त दर्द-निवारक, एंटी-नॉज़िया और तमसुलोसिन रखें।",
                "गंतव्य का नज़दीकी आपातकालीन अस्पताल फ़ोन में सेव करें।",
                "उड़ान में हर घंटे एक कप पानी।",
                "हवाई जहाज़ में शराब, कोल्ड-ड्रिंक और नमकीन से बचें।",
                "यात्रा में हमला हो तो CT/अल्ट्रासाउंड + DJ स्टेंट — बाकी इलाज वापस घर पर।",
            ],
            "gu": [
                "નિદાન અને દવાઓની યાદી સાથેનો યુરોલોજિસ્ટનો પત્ર સાથે રાખો.",
                "અઠવાડિયાની વધારાની દુખાવાની દવા, એન્ટિ-નૉઝિયા અને તમસુલોસિન.",
                "ગંતવ્યના નજીકના ઇમર્જન્સી હૉસ્પિટલનો નંબર ફોનમાં સેવ કરો.",
                "ફ્લાઇટમાં દર કલાકે એક કપ પાણી.",
                "એરપ્લેનમાં દારૂ, કોલ્ડ-ડ્રિંક, નમકીનથી દૂર રહો.",
                "મુસાફરીમાં હુમલો થાય તો CT/અલ્ટ્રાસાઉન્ડ + DJ સ્ટેન્ટ — બાકીનો ઇલાજ પાછા આવીને.",
            ],
        },
    },
    {
        "id": "vasectomy-guide",
        "cover": _IMG_HOSPITAL,
        "title": {
            "en": "Vasectomy — What to Expect",
            "hi": "पुरुष नसबंदी — क्या अपेक्षा करें",
            "gu": "વાસેક્ટમી — શું અપેક્ષા રાખવી",
        },
        "summary": {
            "en": "A safe, reliable, permanent contraception option for men.",
            "hi": "पुरुषों के लिए सुरक्षित, भरोसेमंद, स्थायी गर्भनिरोधक विकल्प।",
            "gu": "પુરુષો માટે સલામત, વિશ્વાસપાત્ર, સ્થાયી ગર્ભનિરોધક વિકલ્પ.",
        },
        "details": {
            "en": (
                "A vasectomy is a short day-care procedure that cuts and seals the two sperm-carrying tubes (vas deferens). "
                "Done under local anaesthetic, it takes 15–20 minutes. It does NOT affect erection, libido, testosterone or ejaculate volume — "
                "only sperm is removed (which is less than 5% of the fluid). Use an alternative contraceptive for 3 months and until a post-op semen "
                "analysis confirms zero sperm. Complication risk is under 2%."
            ),
            "hi": (
                "वैसेक्टमी एक छोटी डे-केयर प्रक्रिया है जिसमें शुक्राणु ले जाने वाली दो नलियाँ (वास डीफेरेन्स) काटी और बंद की जाती हैं। "
                "स्थानीय बेहोशी में 15–20 मिनट लगते हैं। स्तंभन, कामेच्छा, टेस्टोस्टेरोन या वीर्य की मात्रा पर कोई असर नहीं — केवल शुक्राणु निकलते हैं (वीर्य का <5%)। "
                "3 महीने वैकल्पिक गर्भनिरोधक उपयोग करें, और सीमन एनालिसिस में शून्य शुक्राणु मिलने तक जारी रखें। जटिलता <2%।"
            ),
            "gu": (
                "વાસેક્ટમી એ ટૂંકી ડે-કેર પ્રક્રિયા છે જેમાં શુક્રાણુ લઈ જતી બે નળીઓ (વાસ ડીફરન્સ) કાપી-બંધ કરાય છે. "
                "સ્થાનિક બેહોશીમાં 15–20 મિનિટમાં પૂરી થાય. ઇરેક્શન, લિબિડો, ટેસ્ટોસ્ટેરોન કે વીર્યની માત્રા પર કોઈ અસર નહીં — માત્ર શુક્રાણુ નીકળે (વીર્યના <5%). "
                "3 મહિના વૈકલ્પિક ગર્ભનિરોધક વાપરો, સીમન એનાલિસિસમાં શૂન્ય શુક્રાણુ મળે ત્યાં સુધી. જટિલતા <2%."
            ),
        },
        "steps": {
            "en": [
                "Out-patient procedure done under local anaesthetic in 15–20 minutes.",
                "Mild discomfort for 2–3 days — take paracetamol and wear supportive underwear.",
                "Avoid intercourse for 7 days and heavy lifting for 14 days.",
                "Use an alternative contraceptive for 3 months and until semen analysis shows no sperm.",
                "Complication risk (haematoma, infection, chronic pain) is <2%.",
                "Vasectomy does NOT affect erection, libido or volume of ejaculation.",
            ],
            "hi": [
                "OPD प्रक्रिया — स्थानीय बेहोशी में 15–20 मिनट।",
                "2–3 दिन हल्की असुविधा — पैरासिटामोल लें और सपोर्टिव अंडरवेयर पहनें।",
                "7 दिन सहवास और 14 दिन भारी सामान न उठाएँ।",
                "3 महीने वैकल्पिक गर्भनिरोधक; सीमन-एनालिसिस शून्य होने तक।",
                "जटिलता <2% (हेमाटोमा, संक्रमण, पुराना दर्द)।",
                "स्तंभन, कामेच्छा, वीर्य की मात्रा पर कोई असर नहीं।",
            ],
            "gu": [
                "OPD પ્રક્રિયા — સ્થાનિક બેહોશીમાં 15–20 મિનિટ.",
                "2–3 દિવસ હળવી અગવડ — પૅરાસિટામોલ અને સપોર્ટિવ અંડરવેર.",
                "7 દિવસ સંભોગ અને 14 દિવસ ભારે વસ્તુ નહીં ઉપાડવી.",
                "3 મહિના વૈકલ્પિક ગર્ભનિરોધક; સીમન-એનાલિસિસ શૂન્ય થાય ત્યાં સુધી.",
                "જટિલતા <2% (હેમેટોમા, સંક્રમણ, ક્રોનિક દુખાવો).",
                "ઇરેક્શન, લિબિડો, વીર્યની માત્રા પર કોઈ અસર નહીં.",
            ],
        },
    },
    {
        "id": "circumcision-care",
        "cover": _IMG_CHILD,
        "title": {
            "en": "Circumcision Aftercare",
            "hi": "खतना (सर्कम्सिजन) की देखभाल",
            "gu": "સુન્નત (સર્ક્યુમ્સિઝન) પછીની સંભાળ",
        },
        "summary": {
            "en": "How to heal quickly and avoid infection after circumcision.",
            "hi": "सर्कम्सिजन के बाद जल्दी ठीक होना और संक्रमण से बचना।",
            "gu": "સુન્નત પછી ઝડપી રુઝ અને સંક્રમણ ટાળવું.",
        },
        "details": {
            "en": (
                "Circumcision is usually performed for phimosis, recurrent balanitis or religious reasons. The wound takes 3–4 weeks to fully mature. "
                "For the first 24 hours keep the dressing dry and undisturbed. Then use warm water baths (no soap on the wound for 7 days) and the prescribed "
                "antibiotic ointment twice daily. Avoid cycling, tight jeans and any sexual activity for 3–4 weeks. Mild swelling and sensitivity are expected."
            ),
            "hi": (
                "खतना आमतौर पर फिमोसिस, बार-बार बैलेनाइटिस या धार्मिक कारणों से किया जाता है। घाव 3–4 सप्ताह में पूरी तरह परिपक्व होता है। "
                "पहले 24 घंटे ड्रेसिंग सूखी और अछूती रखें। फिर गर्म पानी से स्नान (7 दिन घाव पर साबुन नहीं) और निर्धारित एंटीबायोटिक मरहम दिन में 2 बार। "
                "3–4 सप्ताह साइकिलिंग, टाइट जींस और यौन गतिविधि से बचें। हल्की सूजन सामान्य है।"
            ),
            "gu": (
                "સુન્નત સામાન્ય રીતે ફિમોસિસ, વારંવાર બૅલેનાઇટિસ કે ધાર્મિક કારણોસર થાય છે. જખ્મ 3–4 અઠવાડિયામાં સંપૂર્ણ રુઝે છે. "
                "પ્રથમ 24 કલાક ડ્રેસિંગ સૂકું અને અડ્યા વગરનું રાખો. પછી ગરમ પાણી સ્નાન (7 દિવસ જખ્મ પર સાબુ નહીં) અને સૂચવેલો એન્ટિબાયોટિક મલમ દિવસે 2 વાર. "
                "3–4 અઠવાડિયાં સાયકલિંગ, ચુસ્ત જીન્સ અને જાતીય પ્રવૃત્તિ ટાળો. હળવી સૂજણ સામાન્ય."
            ),
        },
        "steps": {
            "en": [
                "Keep the dressing dry and untouched for 24 hours.",
                "After 24 hours, take short warm-water baths — do NOT use soap on the wound for 7 days.",
                "Apply the prescribed antibiotic ointment twice daily for 7 days.",
                "Wear loose cotton underwear; avoid tight jeans or cycling for 3 weeks.",
                "Avoid intercourse or masturbation for 4 weeks to let the wound mature.",
                "Call the clinic if you see pus, severe swelling, or inability to pass urine.",
            ],
            "hi": [
                "पहले 24 घंटे ड्रेसिंग सूखी और अछूती रखें।",
                "24 घंटे बाद गुनगुने पानी का स्नान — 7 दिन घाव पर साबुन नहीं।",
                "सिफारिश की गई एंटीबायोटिक मरहम दिन में 2 बार, 7 दिन।",
                "ढीले सूती अंडरवेयर; 3 सप्ताह टाइट जींस और साइकिलिंग नहीं।",
                "4 सप्ताह सहवास/स्व-संतुष्टि नहीं।",
                "पस, तेज़ सूजन, पेशाब न आना — क्लिनिक संपर्क करें।",
            ],
            "gu": [
                "પ્રથમ 24 કલાક ડ્રેસિંગ સૂકું અને અડ્યા વગર.",
                "24 કલાક પછી ગરમ પાણી સ્નાન — 7 દિવસ જખ્મ પર સાબુ નહીં.",
                "સૂચવેલો એન્ટિબાયોટિક મલમ દિવસે 2 વાર, 7 દિવસ.",
                "ઢીલા સુતરાઉ અંડરવેર; 3 અઠવાડિયા ચુસ્ત જીન્સ કે સાયકલિંગ નહીં.",
                "4 અઠવાડિયા સંભોગ/સ્વ-સંતોષ નહીં.",
                "પરુ, ભારે સૂજણ, પેશાબ ન આવે — ક્લિનિક સંપર્ક.",
            ],
        },
    },
    {
        "id": "pregnancy-urology",
        "cover": _IMG_FAMILY,
        "title": {
            "en": "Urology in Pregnancy",
            "hi": "गर्भावस्था में यूरोलॉजी",
            "gu": "ગર્ભાવસ્થામાં યુરોલોજી",
        },
        "summary": {
            "en": "Safe management of kidney stones, UTIs and hydronephrosis during pregnancy.",
            "hi": "गर्भावस्था में पथरी, UTI और हाइड्रोनेफ्रोसिस का सुरक्षित प्रबंधन।",
            "gu": "ગર્ભાવસ્થામાં પથરી, UTI અને હાઇડ્રોનેફ્રોસિસનું સલામત વ્યવસ્થાપન.",
        },
        "details": {
            "en": (
                "Pregnancy alters renal physiology — mild right-sided hydronephrosis is normal and usually needs no intervention. All asymptomatic "
                "bacteriuria must be treated because untreated UTIs cause preterm labour. Pregnancy-safe antibiotics include nitrofurantoin (avoid near term), "
                "cephalosporins and fosfomycin. For ureteric stones, MRI is the preferred imaging; definitive stone treatment can usually be deferred until "
                "6 weeks postpartum, with a DJ stent as a temporary bridge if needed."
            ),
            "hi": (
                "गर्भावस्था में गुर्दे की सामान्य क्रियाएँ बदलती हैं — दाईं ओर हल्का हाइड्रोनेफ्रोसिस सामान्य है। सभी असिम्प्टोमैटिक बैक्टीरिया का इलाज ज़रूरी क्योंकि UTI से समय-पूर्व प्रसव हो सकता है। "
                "सुरक्षित एंटीबायोटिक: नाइट्रोफ्यूरेंटोइन (अंत के पास बंद), सेफालोस्पोरिन, फ़ॉस्फ़ोमाइसिन। मूत्रवाहिनी की पथरी में MRI पसंद; अंतिम इलाज प्रसव के 6 सप्ताह बाद; DJ स्टेंट अस्थायी पुल।"
            ),
            "gu": (
                "ગર્ભાવસ્થામાં કિડનીની કાર્યવિધિ બદલાય — જમણી તરફ હળવું હાઇડ્રોનેફ્રોસિસ સામાન્ય. અસિમ્પ્ટોમેટિક બૅક્ટેરિયા પણ સારવાર જરૂરી કારણ UTIથી પ્રી-ટર્મ ડિલિવરી થઈ શકે. "
                "સલામત એન્ટિબાયોટિક: નાઇટ્રોફ્યુરેન્ટોઇન (અંત નજીક બંધ), સેફાલોસ્પોરિન, ફૉસ્ફોમાઇસિન. પથરી માટે MRI પસંદ; અંતિમ ઇલાજ પ્રસૂતિના 6 અઠવાડિયા પછી; DJ સ્ટેન્ટ અસ્થાયી."
            ),
        },
        "steps": {
            "en": [
                "Mild right-sided hydronephrosis is normal in pregnancy and rarely needs intervention.",
                "Bacteriuria must be treated even if asymptomatic — untreated UTIs cause preterm labour.",
                "Use pregnancy-safe antibiotics: nitrofurantoin, cephalosporins, fosfomycin.",
                "Avoid fluoroquinolones, tetracyclines and sulfamethoxazole in pregnancy.",
                "Ureteric stone pain — MRI is preferred; if intervention is needed, DJ stent or URS is safe in 2nd trimester.",
                "Definitive stone treatment (RIRS/ESWL) is usually deferred to 6 weeks after delivery.",
            ],
            "hi": [
                "गर्भावस्था में दाईं ओर हल्का हाइड्रोनेफ्रोसिस सामान्य — विशेष इलाज प्राय: ज़रूरी नहीं।",
                "असिम्प्टोमैटिक बैक्टीरिया भी इलाज ज़रूरी — UTI से समय-पूर्व प्रसव होता है।",
                "सुरक्षित एंटीबायोटिक: नाइट्रोफ्यूरेंटोइन, सेफालोस्पोरिन, फ़ॉस्फ़ोमाइसिन।",
                "फ़्लोरोक्विनोलोन, टेट्रासाइक्लिन, सल्फामेथॉक्साज़ोल न दें।",
                "पथरी के दर्द में MRI; ज़रूरत हो तो 2nd ट्राइमेस्टर में DJ स्टेंट/URS सुरक्षित।",
                "अंतिम इलाज (RIRS/ESWL) प्रसव के 6 सप्ताह बाद।",
            ],
            "gu": [
                "ગર્ભાવસ્થામાં જમણી તરફ હળવું હાઇડ્રોનેફ્રોસિસ સામાન્ય — ખાસ ઇલાજ ભાગ્યે જ જરૂરી.",
                "અસિમ્પ્ટોમેટિક બૅક્ટેરિયા પણ ઇલાજ જરૂરી — UTIથી પ્રી-ટર્મ ડિલિવરી.",
                "સલામત એન્ટિબાયોટિક: નાઇટ્રોફ્યુરેન્ટોઇન, સેફાલોસ્પોરિન, ફૉસ્ફોમાઇસિન.",
                "ફ્લોરોક્વિનોલોન, ટેટ્રાસાયક્લાઇન, સલ્ફામેથૉક્સાઝોલ ન આપવા.",
                "પથરીના દુખાવામાં MRI; જરૂર પડે તો 2nd ટ્રાઇમેસ્ટરમાં DJ સ્ટેન્ટ/URS સલામત.",
                "અંતિમ ઇલાજ (RIRS/ESWL) પ્રસૂતિના 6 અઠવાડિયા પછી.",
            ],
        },
    },
    {
        "id": "kidney-donor",
        "cover": _IMG_HOSPITAL,
        "title": {
            "en": "Becoming a Living Kidney Donor",
            "hi": "जीवित गुर्दा दाता बनना",
            "gu": "જીવંત કિડની દાતા બનવું",
        },
        "summary": {
            "en": "What the journey looks like when you gift a kidney to a loved one.",
            "hi": "जब आप अपने किसी प्रियजन को किडनी देते हैं — यह सफर कैसा होता है।",
            "gu": "જ્યારે તમે કોઈ પ્રિય વ્યક્તિને કિડની આપો — આ સફર કેવો હોય.",
        },
        "details": {
            "en": (
                "Living donation is the single best gift of life — recipients do twice as well compared with dialysis. The work-up is rigorous: blood group, "
                "tissue typing, glomerular filtration rate, CT angiography, cardiac fitness and a psychosocial counselling session. "
                "Laparoscopic donor nephrectomy needs 3–4 days in hospital and 4–6 weeks before returning to strenuous work. Desk work resumes at 2 weeks. "
                "Donors have lifelong annual checkups; overall life expectancy matches the general population."
            ),
            "hi": (
                "जीवित दान जीवन का सबसे बड़ा उपहार है — डायलिसिस की तुलना में प्राप्तकर्ता दोगुना अच्छा करते हैं। "
                "मूल्यांकन कठिन है: ब्लड ग्रुप, टिश्यू टाइपिंग, GFR, CT एंजियोग्राफी, हृदय फिटनेस और परामर्श। "
                "लैप्रोस्कोपिक डोनर नेफ्रेक्टमी में 3–4 दिन अस्पताल, भारी काम से पहले 4–6 सप्ताह। डेस्क कार्य 2 सप्ताह में। सालाना जाँच; जीवनकाल सामान्य जनसंख्या जैसा।"
            ),
            "gu": (
                "જીવંત દાન જીવનની સૌથી મોટી ભેટ છે — ડાયાલિસિસ કરતાં લાભાર્થી બમણું સારું કરે. "
                "મૂલ્યાંકન કડક: બ્લડ ગ્રુપ, ટિશ્યૂ ટાઇપિંગ, GFR, CT એન્જિયોગ્રાફી, હૃદય ફિટનેસ અને પરામર્શ. "
                "લૅપ્રોસ્કોપિક ડોનર નેફ્રેક્ટમીમાં 3–4 દિવસ હૉસ્પિટલ, ભારે કામ પહેલાં 4–6 અઠવાડિયા. ડેસ્ક કામ 2 અઠવાડિયે. વાર્ષિક તપાસ; જીવનકાળ સામાન્ય જનસંખ્યા જેવો."
            ),
        },
        "steps": {
            "en": [
                "Complete work-up: blood group, tissue typing, GFR, cardiac fitness and CT angiography.",
                "Counselling by a transplant coordinator — decision is entirely voluntary.",
                "Laparoscopic donor nephrectomy — 3–4 days in hospital.",
                "4–6 weeks rest from strenuous work; desk work can resume at 2 weeks.",
                "Life-long yearly check-up: BP, creatinine, urine protein.",
                "Donors generally live as long as the general population — the remaining kidney compensates by ~70%.",
            ],
            "hi": [
                "मूल्यांकन: ब्लड ग्रुप, टिश्यू टाइपिंग, GFR, हृदय फिटनेस, CT एंजियोग्राफी।",
                "ट्रांसप्लांट समन्वयक से परामर्श — निर्णय पूर्णत: स्वैच्छिक।",
                "लैप्रोस्कोपिक डोनर नेफ्रेक्टमी — 3–4 दिन अस्पताल।",
                "भारी काम से 4–6 सप्ताह आराम; डेस्क कार्य 2 सप्ताह में।",
                "आजीवन सालाना जाँच: BP, क्रिएटिनिन, मूत्र प्रोटीन।",
                "दाता सामान्य जनसंख्या की तरह जीते हैं — बचा गुर्दा ~70% काम करता है।",
            ],
            "gu": [
                "મૂલ્યાંકન: બ્લડ ગ્રુપ, ટિશ્યૂ ટાઇપિંગ, GFR, હૃદય ફિટનેસ, CT એન્જિયોગ્રાફી.",
                "ટ્રાન્સપ્લાન્ટ કો-ઓર્ડિનેટર પાસે પરામર્શ — નિર્ણય સંપૂર્ણપણે સ્વૈચ્છિક.",
                "લૅપ્રોસ્કોપિક ડોનર નેફ્રેક્ટમી — 3–4 દિવસ હૉસ્પિટલ.",
                "ભારે કામથી 4–6 અઠવાડિયા આરામ; ડેસ્ક કામ 2 અઠવાડિયે.",
                "આજીવન વાર્ષિક તપાસ: BP, ક્રિએટિનિન, યુરિન પ્રોટીન.",
                "દાતા સામાન્ય જનસંખ્યા જેટલું જીવે — બચેલી કિડની ~70% કાર્ય કરે.",
            ],
        },
    },
    {
        "id": "telehealth-tips",
        "cover": _IMG_TELE,
        "title": {
            "en": "Getting the Most from Your Telehealth Visit",
            "hi": "अपनी टेलीहेल्थ विज़िट का अधिकतम लाभ उठाएँ",
            "gu": "તમારી ટેલીહેલ્થ વિઝિટનો મહત્તમ લાભ લો",
        },
        "summary": {
            "en": "Preparing for a productive online consultation — for patients and their families.",
            "hi": "एक उपयोगी ऑनलाइन परामर्श की तैयारी — रोगी और परिवार दोनों के लिए।",
            "gu": "અસરકારક ઑનલાઇન પરામર્શની તૈયારી — દર્દી અને પરિવાર બંને માટે.",
        },
        "details": {
            "en": (
                "A well-prepared 15-minute telehealth visit can replace three in-person follow-ups. Use a quiet well-lit room, stable internet, "
                "headphones for privacy, and keep every report/medication within arm's reach. Record a BP and blood sugar before the call if you have the "
                "equipment. Write down the three most important questions you need answered and share them at the start so the doctor can structure the visit."
            ),
            "hi": (
                "अच्छी तैयारी वाली 15-मिनट की टेलीहेल्थ मुलाक़ात 3 आमने-सामने फॉलो-अप की जगह ले सकती है। शांत, अच्छी रोशनी वाला कमरा, स्थिर इंटरनेट, हेडफ़ोन और सभी रिपोर्ट/दवाएँ हाथ में रखें। "
                "BP और ब्लड शुगर पहले ही रिकॉर्ड कर लें। अपने 3 मुख्य प्रश्न लिख कर शुरू में ही साझा करें।"
            ),
            "gu": (
                "સારી તૈયારીની 15-મિનિટની ટેલીહેલ્થ મુલાકાત 3 રૂબરૂ ફૉલો-અપ્સની જગ્યા લઈ શકે. શાંત, સારી પ્રકાશવાળા ઓરડામાં, સ્થિર ઇન્ટરનેટ, હેડફોન અને બધા રિપોર્ટ/દવા હાથવગા રાખો. "
                "BP અને શુગર પહેલાં જ નોંધી લો. તમારા 3 મુખ્ય પ્રશ્નો લખી પ્રારંભમાં શેર કરો."
            ),
        },
        "steps": {
            "en": [
                "Choose a quiet, well-lit room with stable internet.",
                "Keep your medications, recent blood & urine reports, and past surgery summaries handy.",
                "If you have a blood pressure or glucose meter, record a reading just before the call.",
                "Have a bladder diary ready if booked for LUTS — 3 days of fluid in and urine out.",
                "Use headphones to protect privacy and for clearer audio.",
                "Write down 3 main questions you want answered by the end of the session.",
            ],
            "hi": [
                "शांत, अच्छी रोशनी वाला कमरा और स्थिर इंटरनेट।",
                "दवाइयाँ, हाल की ब्लड/यूरिन रिपोर्ट, पिछली सर्जरी के सार हाथ में रखें।",
                "BP या ग्लूकोज़ मीटर हो तो कॉल से पहले माप लें।",
                "LUTS की बुकिंग हो तो 3 दिनों की bladder diary तैयार रखें।",
                "गोपनीयता और स्पष्ट ऑडियो के लिए हेडफ़ोन।",
                "3 मुख्य प्रश्न लिखकर रखें और सत्र के अंत तक पूछें।",
            ],
            "gu": [
                "શાંત, સારી પ્રકાશવાળો ઓરડો અને સ્થિર ઇન્ટરનેટ.",
                "દવાઓ, તાજેતરના બ્લડ/યુરિન રિપોર્ટ, અગાઉની સર્જરી સારાંશ સાથે રાખો.",
                "BP કે ગ્લુકોઝ મીટર હોય તો કૉલ પહેલાં માપી લો.",
                "LUTS માટે બુકિંગ હોય તો 3 દિવસની bladder diary તૈયાર.",
                "ગુપ્તતા અને સ્પષ્ટ ઑડિયો માટે હેડફોન.",
                "3 મુખ્ય પ્રશ્નો લખી સત્રને અંતે પૂછી લો.",
            ],
        },
    },
    {
        "id": "sexual-health-general",
        "cover": _IMG_ED,
        "title": {
            "en": "Sexual Health — Red Flags to Never Ignore",
            "hi": "यौन स्वास्थ्य — कभी नज़रअंदाज़ न करें ये संकेत",
            "gu": "યૌન આરોગ્ય — ક્યારેય નકારવી ન જોઈતી નિશાનીઓ",
        },
        "summary": {
            "en": "Symptoms that deserve urgent urology evaluation — do not wait.",
            "hi": "ऐसे लक्षण जिन्हें तुरंत यूरोलॉजिस्ट को दिखाना चाहिए — देर न करें।",
            "gu": "લક્ષણો જે તાત્કાલિક યુરોલોજિસ્ટને બતાવવા જોઈએ — રાહ ન જુઓ.",
        },
        "details": {
            "en": (
                "Most men feel uncomfortable talking about sexual-health problems, which delays diagnosis of serious conditions. A sudden painless "
                "testicular lump is testicular cancer until proven otherwise — it has one of the highest cure rates if caught early. An erection lasting "
                "more than 4 hours (priapism) is an emergency. New-onset ED in a man under 40 is frequently the first sign of vascular disease. "
                "Persistent blood in semen, painful ejaculation or penile curvature all deserve prompt evaluation."
            ),
            "hi": (
                "अधिकांश पुरुष यौन समस्याओं पर बात करने में संकोच करते हैं, जिससे निदान में देरी हो जाती है। अचानक दर्द-रहित अंडकोष गाँठ को तब तक कैंसर माना जाता है जब तक सिद्ध न हो — जल्दी पकड़ने पर इलाज दर सबसे अधिक। "
                "4 घंटे से अधिक स्तंभन (प्रायपिज़्म) आपातकाल है। 40 से कम उम्र में नया-नया ED अक्सर हृदय रोग का पहला संकेत। वीर्य में खून, दर्दनाक स्खलन या लिंग का टेढ़ा होना — तुरंत जाँच।"
            ),
            "gu": (
                "મોટાભાગના પુરુષો યૌન સમસ્યાઓ વિશે વાત કરવામાં સંકોચ અનુભવે છે, જેથી ગંભીર નિદાનમાં વિલંબ થાય. અચાનક દુખાવા વગરની વૃષણ ગાંઠને કૅન્સર ન સિદ્ધ થાય ત્યાં સુધી કૅન્સર જ માનવામાં આવે — વહેલાં પકડાય તો ઇલાજ દર સૌથી ઊંચો. "
                "4 કલાકથી વધુ ઇરેક્શન (પ્રાયપિઝમ) ઇમરજન્સી છે. 40થી ઓછી ઉંમરે નવું ED ઘણી વાર હૃદયરોગની પહેલી નિશાની. વીર્યમાં લોહી, દર્દભર્યું સ્ખલન કે લિંગની વાંકડ — તરત તપાસ."
            ),
        },
        "steps": {
            "en": [
                "Erection lasting > 4 hours → go to ER (priapism).",
                "Sudden painless lump in a testicle → urology within a week.",
                "Sudden curvature of the penis with painful erections → likely Peyronie's, start treatment early.",
                "Blood in semen that lasts > 3 weeks or is recurrent.",
                "Persistent pain or burning during ejaculation.",
                "New-onset ED in a man under 40 — often the first sign of vascular disease.",
            ],
            "hi": [
                "4 घंटे से अधिक स्तंभन → आपातकालीन (प्रायपिज़्म)।",
                "अंडकोष में अचानक दर्द-रहित गाँठ → एक सप्ताह में यूरोलॉजी।",
                "लिंग का टेढ़ा होना + दर्दनाक स्तंभन → संभवत: Peyronie's, जल्दी इलाज शुरू।",
                "3 सप्ताह से अधिक या बार-बार वीर्य में खून।",
                "स्खलन में लगातार दर्द/जलन।",
                "40 से कम उम्र में नया ED — अक्सर हृदय रोग का पहला संकेत।",
            ],
            "gu": [
                "4 કલાકથી વધુ ઇરેક્શન → ઇમરજન્સી (પ્રાયપિઝમ).",
                "વૃષણમાં અચાનક દુખાવા વગરની ગાંઠ → અઠવાડિયામાં યુરોલોજી.",
                "લિંગનું વાંકું થવું + દુખાવાવાળું ઇરેક્શન → સંભવતઃ Peyronie's, વહેલો ઇલાજ.",
                "3 અઠવાડિયાથી વધુ કે વારંવાર વીર્યમાં લોહી.",
                "સ્ખલનમાં સતત દુખાવો/બળતરા.",
                "40થી ઓછી ઉંમરે નવું ED — ઘણી વાર હૃદયરોગની પહેલી નિશાની.",
            ],
        },
    },
    {
        "id": "prostate-cancer-screening",
        "cover": _IMG_CANCER,
        "title": {
            "en": "Prostate Cancer — Early Detection",
            "hi": "प्रोस्टेट कैंसर — शुरुआती पहचान",
            "gu": "પ્રોસ્ટેટ કૅન્સર — વહેલી તપાસ",
        },
        "summary": {
            "en": "Prostate cancer caught early is curable. Know when to screen.",
            "hi": "शुरुआत में पकड़ा गया प्रोस्टेट कैंसर पूरी तरह ठीक हो सकता है।",
            "gu": "વહેલું પકડાયેલું પ્રોસ્ટેટ કૅન્સર પૂરી રીતે મટાડી શકાય છે.",
        },
        "details": {
            "en": (
                "Prostate cancer is the second commonest cancer in Indian men. Early disease has no symptoms — the only way to catch it is screening: "
                "an annual PSA and DRE from age 50 (or 45 if there is a family history or African-Asian ancestry). "
                "A modern workup uses multiparametric MRI before biopsy, minimising unnecessary procedures. "
                "Localised cancer today has over 95% cure rate with surgery, radiotherapy or focal therapy. Advanced disease can still be controlled for many years."
            ),
            "hi": (
                "भारतीय पुरुषों में प्रोस्टेट कैंसर दूसरा सबसे आम कैंसर है। शुरुआत में कोई लक्षण नहीं — स्क्रीनिंग ही रास्ता है: "
                "50 वर्ष से सालाना PSA और DRE (परिवार में इतिहास हो तो 45 से)। "
                "आधुनिक जांच में बायोप्सी से पहले MRI होती है। स्थानीय कैंसर का 95%+ इलाज सर्जरी, रेडियोथेरेपी या फोकल थेरेपी से संभव।"
            ),
            "gu": (
                "ભારતીય પુરુષોમાં પ્રોસ્ટેટ કૅન્સર બીજું સૌથી સામાન્ય કૅન્સર છે. શરૂઆતમાં કોઈ લક્ષણ નહીં — સ્ક્રીનિંગ જ એકમાત્ર રસ્તો: "
                "50 વર્ષથી વાર્ષિક PSA અને DRE (પરિવારમાં હોય તો 45થી). "
                "આધુનિક તપાસમાં બાયોપ્સી પહેલાં MRI થાય. સ્થાનિક કૅન્સરનો 95%+ ઇલાજ સર્જરી, રેડિયોથેરેપી કે ફોકલ થેરેપીથી શક્ય."
            ),
        },
        "steps": {
            "en": [
                "Annual PSA from age 50 (45 with a family history).",
                "Report any new urinary symptoms, blood in urine or bone pain.",
                "Elevated PSA → multiparametric MRI prostate before biopsy.",
                "Confirmed cancer → surgery, radiotherapy, or active surveillance based on risk.",
                "Robotic radical prostatectomy offers precise cancer control with continence preservation.",
                "Treatment is highly individualised — always seek a second urology opinion for major decisions.",
            ],
            "hi": [
                "50 वर्ष से सालाना PSA (परिवार में हो तो 45 से)।",
                "पेशाब की नई समस्या, खून, हड्डी में दर्द — तुरंत बताइए।",
                "PSA बढ़ा हो तो बायोप्सी से पहले MRI।",
                "कैंसर की पुष्टि पर सर्जरी, रेडियोथेरेपी या सक्रिय निगरानी — जोखिम के अनुसार।",
                "रोबोटिक रेडिकल प्रोस्टेटेक्टॉमी सटीक इलाज व निरंतरता बनाए रखती है।",
                "हर निर्णय पर दूसरी यूरोलॉजी राय लें।",
            ],
            "gu": [
                "50 વર્ષથી વાર્ષિક PSA (પરિવારમાં હોય તો 45થી).",
                "પેશાબની નવી સમસ્યા, લોહી, હાડકાંમાં દુખાવો — તરત જણાવો.",
                "PSA વધે તો બાયોપ્સી પહેલાં MRI.",
                "કૅન્સર પુષ્ટિ થાય તો સર્જરી, રેડિયોથેરેપી કે સક્રિય દેખરેખ — જોખમ પ્રમાણે.",
                "રોબોટિક રેડિકલ પ્રોસ્ટેટેક્ટમી ચોક્કસ ઇલાજ અને કંટ્રોલ આપે છે.",
                "મોટા નિર્ણયોમાં બીજા યુરોલોજિસ્ટનો અભિપ્રાય લો.",
            ],
        },
    },
    {
        "id": "bladder-cancer-haematuria",
        "cover": _IMG_BLOOD,
        "title": {
            "en": "Bladder Cancer & Haematuria",
            "hi": "मूत्राशय कैंसर व पेशाब में खून",
            "gu": "મૂત્રાશય કૅન્સર અને પેશાબમાં લોહી",
        },
        "summary": {
            "en": "Painless blood in urine is bladder cancer until proven otherwise.",
            "hi": "दर्द-रहित पेशाब में खून को तब तक कैंसर मानें जब तक सिद्ध न हो।",
            "gu": "દુખાવા વગર પેશાબમાં લોહી એ કૅન્સર ન સિદ્ધ થાય ત્યાં સુધી કૅન્સર જ માનવું.",
        },
        "details": {
            "en": (
                "Bladder cancer is strongly linked to smoking — 4× higher risk. The hallmark symptom is painless visible blood in urine. "
                "Any single episode, even if it resolves, demands investigation: urine cytology, flexible cystoscopy and CT urogram. "
                "Caught early (non-muscle invasive), bladder cancer has >85% 5-year survival. Delay allows progression to muscle-invasive disease which may need cystectomy. "
                "Never dismiss blood in urine as 'just a UTI' — a confirmed UTI does not exclude an underlying tumour."
            ),
            "hi": (
                "मूत्राशय कैंसर धूम्रपान से गहराई से जुड़ा है — जोखिम 4 गुना। मुख्य लक्षण दर्द-रहित पेशाब में खून। "
                "एक बार भी हो, जांच ज़रूरी: urine cytology, फ्लेक्सिबल सिस्टोस्कोपी, CT यूरोग्राम। "
                "शुरुआती स्तर पर 5-वर्षीय जीवित रहने की दर 85%+; देर से पकड़ने पर मूत्राशय हटाना पड़ सकता है। "
                "पेशाब में खून को 'सिर्फ UTI' समझकर न छोड़ें।"
            ),
            "gu": (
                "મૂત્રાશય કૅન્સર ધૂમ્રપાન સાથે ગાઢ જોડાયેલું છે — જોખમ 4 ગણું. મુખ્ય લક્ષણ દુખાવા વગર પેશાબમાં લોહી. "
                "એક જ વાર પણ થાય તો તપાસ જરૂરી: યુરિન સાયટોલોજી, ફ્લેક્સિબલ સિસ્ટોસ્કોપી, CT યુરોગ્રામ. "
                "શરૂઆતમાં 5-વર્ષ જીવિતતા 85%+; મોડું પકડાય તો મૂત્રાશય કાઢવું પડી શકે. "
                "પેશાબમાં લોહી 'માત્ર UTI' ગણી છોડી ન દેવું."
            ),
        },
        "steps": {
            "en": [
                "Painless visible blood in urine → urology review the same week.",
                "Smokers and dye-industry workers are at highest risk.",
                "Workup: urine cytology, flexible cystoscopy, CT urogram.",
                "Treatment: tumour resection (TURBT) + intravesical BCG for early disease.",
                "Advanced disease may need radical cystectomy and urinary diversion.",
                "Quit smoking — the single most important preventive step.",
            ],
            "hi": [
                "दर्द-रहित पेशाब में खून → उसी सप्ताह यूरोलॉजी।",
                "धूम्रपान करने वाले और डाई-उद्योग कार्यकर्ता सर्वाधिक जोखिम में।",
                "जांच: urine cytology, फ्लेक्सिबल सिस्टोस्कोपी, CT यूरोग्राम।",
                "इलाज: ट्यूमर निकालना (TURBT) + BCG दवा बार-बार न हो इसके लिए।",
                "उन्नत अवस्था में मूत्राशय हटाना व डायवर्ज़न।",
                "धूम्रपान बंद करें — सबसे महत्वपूर्ण रोकथाम।",
            ],
            "gu": [
                "દુખાવા વગર પેશાબમાં લોહી → એ જ અઠવાડિયે યુરોલોજી.",
                "ધૂમ્રપાન અને ડાઈ-ઉદ્યોગના કામદારો સૌથી વધુ જોખમમાં.",
                "તપાસ: યુરિન સાયટોલોજી, ફ્લેક્સિબલ સિસ્ટોસ્કોપી, CT યુરોગ્રામ.",
                "ઇલાજ: ટ્યૂમર રિસેક્શન (TURBT) + BCG ફરી ન થવા માટે.",
                "અગ્રસ્થ રોગમાં મૂત્રાશય કાઢીને ડાયવર્ઝન.",
                "ધૂમ્રપાન બંધ — સૌથી મહત્વનું નિવારણ.",
            ],
        },
    },
    {
        "id": "kidney-cancer",
        "cover": _IMG_CANCER,
        "title": {
            "en": "Kidney Cancer (Renal Cell Carcinoma)",
            "hi": "गुर्दे का कैंसर (RCC)",
            "gu": "કિડની કૅન્સર (RCC)",
        },
        "summary": {
            "en": "Most kidney tumours are found by chance on a scan. Early ones are highly curable.",
            "hi": "गुर्दे के अधिकांश ट्यूमर CT/अल्ट्रासाउंड में संयोगवश मिलते हैं।",
            "gu": "મોટા ભાગના કિડની ટ્યૂમર CT/અલ્ટ્રાસાઉન્ડમાં આકસ્મિક રીતે મળે છે.",
        },
        "details": {
            "en": (
                "Two-thirds of kidney cancers today are picked up incidentally during a scan done for another reason. The classic triad "
                "(flank pain + mass + haematuria) appears only in advanced disease. Partial nephrectomy — removing only the tumour — is "
                "preferred for tumours under 7 cm, preserving kidney function. Surgery can be open, laparoscopic or robotic. "
                "Small (<4 cm) low-risk tumours in the elderly may be safely monitored with 6-monthly scans (active surveillance)."
            ),
            "hi": (
                "आज दो-तिहाई गुर्दा कैंसर किसी और कारण से किए गए स्कैन में संयोगवश मिलते हैं। कमर दर्द + गाँठ + खून — ये सब एक साथ केवल उन्नत अवस्था में। "
                "7 सेमी से छोटे ट्यूमर में केवल ट्यूमर निकालना (पार्शियल नेफ्रेक्टमी) बेहतर विकल्प है। "
                "सर्जरी ओपन, लैप्रोस्कोपिक या रोबोटिक हो सकती है। वृद्धों में 4 सेमी से छोटे ट्यूमर की 6-मासिक निगरानी सुरक्षित विकल्प है।"
            ),
            "gu": (
                "આજે બે-તૃતીયાંશ કિડની કૅન્સર બીજા કારણે કરેલા સ્કૅનમાં આકસ્મિક મળે છે. કમરમાં દુખાવો + ગાંઠ + લોહી સાથે માત્ર અગ્રસ્થ અવસ્થામાં. "
                "7 સે.મી.થી નાની ગાંઠમાં માત્ર ટ્યૂમર કાઢવું (પાર્શિયલ નેફ્રેક્ટમી) વધુ સારું. "
                "સર્જરી ઓપન, લૅપ્રોસ્કોપિક કે રોબોટિક. વૃદ્ધોમાં 4 સે.મી.થી નાની ગાંઠની 6-માસિક દેખરેખ સલામત."
            ),
        },
        "steps": {
            "en": [
                "Most kidney cancers are found by chance on a CT or USG done for something else.",
                "A solid enhancing kidney mass > 3 cm usually needs surgery.",
                "Partial nephrectomy (tumour-only removal) is preferred when feasible.",
                "Small low-risk tumours in older patients can be monitored with 6-monthly scans.",
                "Smoking, obesity and hypertension are modifiable risk factors.",
                "Follow-up imaging is critical for 5–10 years after surgery.",
            ],
            "hi": [
                "अधिकांश गुर्दा कैंसर किसी अन्य CT/USG में संयोगवश मिलते हैं।",
                "3 cm से बड़ी सॉलिड एन्हांसिंग किडनी गाँठ — प्राय: सर्जरी।",
                "जब संभव हो पार्शियल नेफ्रेक्टमी बेहतर।",
                "वृद्धों में छोटे कम-जोखिम ट्यूमर की 6-मासिक निगरानी।",
                "धूम्रपान, मोटापा, BP — बदले जा सकने वाले जोखिम।",
                "सर्जरी के बाद 5–10 वर्ष तक फॉलो-अप imaging ज़रूरी।",
            ],
            "gu": [
                "મોટાભાગના કિડની કૅન્સર બીજી CT/USGમાં આકસ્મિક મળે.",
                "3 સે.મી.થી મોટી સોલિડ કિડની ગાંઠ — સામાન્ય રીતે સર્જરી.",
                "શક્ય હોય ત્યાં પાર્શિયલ નેફ્રેક્ટમી વધુ સારી.",
                "વૃદ્ધોમાં નાની ઓછી-જોખમ ગાંઠની 6-માસિક દેખરેખ.",
                "ધૂમ્રપાન, સ્થૂળતા, BP — બદલી શકાય તેવા જોખમ.",
                "સર્જરી પછી 5–10 વર્ષ ફૉલો-અપ imaging.",
            ],
        },
    },
    {
        "id": "testicular-self-exam",
        "cover": _IMG_MALE,
        "title": {
            "en": "Testicular Self-Examination",
            "hi": "अंडकोष की स्व-जांच",
            "gu": "વૃષણની સ્વ-તપાસ",
        },
        "summary": {
            "en": "A 2-minute monthly habit that saves lives — testicular cancer is highly curable when caught early.",
            "hi": "मासिक 2-मिनट की आदत जो जान बचाती है — जल्दी पकड़ने पर 95%+ इलाज।",
            "gu": "2-મિનિટની માસિક આદત જે જીવ બચાવે — વહેલું પકડાય તો 95%+ ઇલાજ.",
        },
        "details": {
            "en": (
                "Testicular cancer mainly affects men aged 15–35, making it the commonest solid cancer in young men. Good news: when detected early, "
                "cure rate exceeds 95%. The self-exam takes 2 minutes, best done once a month after a warm shower when the scrotum is relaxed. "
                "Look and feel for any hard painless lump, swelling, or change in size. Any positive finding should be evaluated by a urologist within a week — "
                "scrotal ultrasound is the first investigation."
            ),
            "hi": (
                "अंडकोष कैंसर मुख्यत: 15–35 वर्ष के पुरुषों में — युवाओं में सबसे आम सॉलिड कैंसर। "
                "अच्छी खबर: जल्दी पकड़ने पर 95%+ इलाज। स्व-जांच 2 मिनट में — गर्म नहाने के बाद जब अंडकोष ढीला हो। "
                "कोई कठोर दर्द-रहित गाँठ, सूजन, या आकार बदलाव देखें। मिलने पर एक सप्ताह में यूरोलॉजिस्ट — स्क्रोटल USG पहली जांच।"
            ),
            "gu": (
                "વૃષણ કૅન્સર મુખ્યત્વે 15–35 વર્ષના પુરુષોમાં — યુવાનોમાં સૌથી સામાન્ય સૉલિડ કૅન્સર. "
                "સારું સમાચાર: વહેલું પકડાય તો 95%+ ઇલાજ. સ્વ-તપાસ 2 મિનિટમાં — ગરમ સ્નાન પછી જ્યારે વૃષણ ઢીલું હોય. "
                "કઠણ દુખાવા વગરની ગાંઠ, સૂજણ, કદમાં ફેરફાર જોવો. મળે તો અઠવાડિયામાં યુરોલોજિસ્ટ — સ્ક્રોટલ USG પહેલી તપાસ."
            ),
        },
        "steps": {
            "en": [
                "Examine monthly after a warm shower — the scrotal skin is relaxed.",
                "Hold each testicle with both hands; roll gently between fingers and thumb.",
                "Feel for any hard painless lump or change in size/firmness.",
                "Note the epididymis at the back — it is normally soft and tube-like.",
                "Any new lump → urology within a week. Scrotal USG is the first test.",
                "Testicular cancer is highly curable when caught early (>95% cure rate).",
            ],
            "hi": [
                "गर्म नहाने के बाद मासिक जांच — त्वचा ढीली होती है।",
                "हर अंडकोष को दोनों हाथों से पकड़ें, अंगूठे-उँगली से धीरे घुमाएँ।",
                "कठोर दर्द-रहित गाँठ या आकार/दृढ़ता में बदलाव देखें।",
                "पीछे एपिडिडायमिस नरम-नलीनुमा होना सामान्य है।",
                "नई गाँठ → एक सप्ताह में यूरोलॉजी; पहला टेस्ट स्क्रोटल USG।",
                "जल्दी पकड़ने पर 95%+ इलाज दर।",
            ],
            "gu": [
                "ગરમ સ્નાન પછી માસિક તપાસ — ત્વચા ઢીલી હોય.",
                "દર વૃષણને બંને હાથમાં પકડી અંગૂઠા-આંગળીથી હળવેથી ફેરવો.",
                "કઠણ દુખાવા વગરની ગાંઠ કે કદ/દ્રઢતામાં ફેરફાર જોવો.",
                "પાછળ એપિડિડાઇમિસ નરમ-નળી જેવું સામાન્ય છે.",
                "નવી ગાંઠ → અઠવાડિયામાં યુરોલોજી; પહેલો ટેસ્ટ સ્ક્રોટલ USG.",
                "વહેલું પકડાય તો 95%+ ઇલાજ દર.",
            ],
        },
    },
    {
        "id": "overactive-bladder",
        "cover": _IMG_BLADDER,
        "title": {
            "en": "Overactive Bladder (OAB)",
            "hi": "अतिसक्रिय मूत्राशय (OAB)",
            "gu": "અતિસક્રિય મૂત્રાશય (OAB)",
        },
        "summary": {
            "en": "Sudden urgency, frequency, and leaks — manageable with training, diet and medication.",
            "hi": "अचानक तेज़ इच्छा, बार-बार पेशाब, रिसाव — व्यायाम, आहार व दवा से काबू।",
            "gu": "અચાનક તીવ્ર ઇચ્છા, વારંવાર પેશાબ, લીક — તાલીમ, આહાર અને દવાથી કાબૂ.",
        },
        "details": {
            "en": (
                "OAB affects 1 in 6 adults and worsens with age. First-line therapy is lifestyle: bladder training, Kegels and avoiding caffeine/alcohol. "
                "Anticholinergics (solifenacin, tolterodine) and beta-3 agonists (mirabegron) are effective second-line options. "
                "For refractory cases, intravesical Botox injections relax the bladder for 6–9 months; sacral neuromodulation is a last-resort device therapy. "
                "Always exclude UTI, bladder stones and tumours before labelling symptoms as idiopathic OAB."
            ),
            "hi": (
                "OAB 6 में 1 वयस्क को प्रभावित करता है; उम्र के साथ बढ़ता है। पहली पंक्ति जीवनशैली: मूत्राशय प्रशिक्षण, केगल, कैफ़ीन/शराब से परहेज़। "
                "एंटिकोलिनर्जिक (सॉलिफ़ेनेसिन) और बीटा-3 एगोनिस्ट (मिराबेग्रॉन) प्रभावी दवाएँ। "
                "प्रतिरोधी मामलों में बोटॉक्स (6–9 माह); सैक्रल न्यूरोमॉड्यूलेशन अंतिम विकल्प। "
                "पहले UTI, पथरी, ट्यूमर को बाहर करें।"
            ),
            "gu": (
                "OAB દર 6માં 1 વયસ્કને અસર કરે; ઉંમર સાથે વધે. પહેલી હરોળ જીવનશૈલી: મૂત્રાશય તાલીમ, કેગલ, કૅફીન/દારૂથી દૂર. "
                "એન્ટિકોલિનર્જિક (સોલિફેનેસિન) અને બીટા-3 (મિરાબેગ્રૉન) અસરકારક. "
                "પ્રતિરોધક કેસમાં Botox (6–9 માસ); સૅક્રલ ન્યુરોમોડ્યુલેશન છેલ્લો વિકલ્પ. "
                "પહેલાં UTI, પથરી, ટ્યૂમર બાકાત કરો."
            ),
        },
        "steps": {
            "en": [
                "Keep a bladder diary for 3 days to quantify urgency and frequency.",
                "Start bladder training + Kegels + reduce caffeine, alcohol and carbonated drinks.",
                "Medicines: solifenacin / mirabegron; expect 4–6 weeks for full effect.",
                "Rule out UTI with urine analysis before starting medicines.",
                "Botox injection in the bladder wall offers 6–9 months relief for refractory cases.",
                "Avoid drinking large volumes late at night — split intake through the day.",
            ],
            "hi": [
                "3 दिन bladder diary — इच्छा व आवृत्ति मापें।",
                "मूत्राशय प्रशिक्षण + केगल + कैफ़ीन/शराब/सोडा कम।",
                "दवा: सॉलिफ़ेनेसिन/मिराबेग्रॉन; पूरा असर 4–6 सप्ताह।",
                "दवा शुरू करने से पहले UTI बाहर करें।",
                "प्रतिरोधी में बोटॉक्स 6–9 माह राहत।",
                "रात देर से अधिक पानी न पिएँ।",
            ],
            "gu": [
                "3 દિવસ bladder diary — ઇચ્છા-આવૃત્તિ માપો.",
                "મૂત્રાશય તાલીમ + કેગલ + કૅફીન/દારૂ/સોડા ઓછું.",
                "દવા: સોલિફેનેસિન/મિરાબેગ્રૉન; પૂરી અસર 4–6 અઠવાડિયે.",
                "દવા પહેલાં UTI બાકાત કરો.",
                "પ્રતિરોધકમાં Botox 6–9 માસની રાહત.",
                "રાત્રે મોડું વધુ પાણી ન પીઓ.",
            ],
        },
    },
    {
        "id": "nocturia",
        "cover": _IMG_NIGHT,
        "title": {
            "en": "Nocturia — Waking at Night to Urinate",
            "hi": "रात्रि मूत्रता (Nocturia)",
            "gu": "રાત્રિ મૂત્રતા (Nocturia)",
        },
        "summary": {
            "en": "Waking twice or more each night to urinate disturbs sleep and has treatable causes.",
            "hi": "रात में 2 या अधिक बार उठना नींद खराब करता है; इलाज संभव है।",
            "gu": "રાત્રે 2 કે વધુ વાર ઊઠવું ઊંઘ બગાડે; ઇલાજ શક્ય છે.",
        },
        "details": {
            "en": (
                "Nocturia is not a normal part of ageing. Causes include BPH, OAB, diabetes, heart failure, sleep apnoea, nocturnal polyuria and evening fluid overload. "
                "A simple frequency-volume chart categorises the type: producing >33% of 24-hour urine at night means nocturnal polyuria (fluid shift)—responsive to evening fluid restriction "
                "and short-acting desmopressin. Bladder causes respond to BPH/OAB therapy. Untreated nocturia increases fall and fracture risk in the elderly."
            ),
            "hi": (
                "Nocturia उम्र का सामान्य हिस्सा नहीं है। कारण: BPH, OAB, मधुमेह, हृदय विफलता, स्लीप एपनिया, रात-पॉलीयूरिया। "
                "frequency-volume chart से पता लगता है: 33%+ मूत्र रात में आए तो पॉलीयूरिया — शाम को पानी कम + desmopressin से आराम। "
                "मूत्राशय कारण BPH/OAB इलाज से ठीक। बिना इलाज वृद्धों में गिरने व फ्रैक्चर का जोखिम।"
            ),
            "gu": (
                "Nocturia ઉંમરનો સામાન્ય ભાગ નથી. કારણો: BPH, OAB, ડાયાબિટિસ, હૃદય નિષ્ફળતા, સ્લીપ ઍપ્નિયા, રાત્રિ-પોલીયુરિયા. "
                "frequency-volume chartથી ખબર પડે: 33%+ પેશાબ રાત્રે થાય તો પોલીયુરિયા — સાંજે પાણી ઓછું + desmopressin. "
                "મૂત્રાશય કારણ BPH/OAB ઇલાજથી મટે. ઇલાજ વિના વૃદ્ધોમાં પડવા-ફ્રૅક્ચરનું જોખમ."
            ),
        },
        "steps": {
            "en": [
                "Maintain a 3-day frequency-volume chart.",
                "Stop fluids 2 hours before bed; elevate legs in the evening.",
                "Treat sleep apnoea (CPAP) and diabetes (glycaemic control).",
                "BPH/OAB specific medication — alpha-blocker, anticholinergic, beta-3 agonist.",
                "Desmopressin tablets at night for confirmed nocturnal polyuria (under supervision).",
                "Keep a night light on and a urinal / commode near the bed for safety.",
            ],
            "hi": [
                "3 दिन frequency-volume chart बनाएँ।",
                "सोने से 2 घंटे पहले पानी बंद; शाम को पैर ऊपर करें।",
                "स्लीप एपनिया (CPAP) व शुगर का अच्छा नियंत्रण।",
                "BPH/OAB की दवा — अल्फा-ब्लॉकर, एंटिकोलिनर्जिक, beta-3।",
                "रात-पॉलीयूरिया में desmopressin (चिकित्सक की देखरेख में)।",
                "रात का प्रकाश + यूरिनल पास रखें।",
            ],
            "gu": [
                "3 દિવસ frequency-volume chart.",
                "ઊંઘ પહેલાં 2 કલાક પાણી બંધ; સાંજે પગ ઊંચા.",
                "સ્લીપ ઍપ્નિયા (CPAP) અને શુગર કાબૂમાં.",
                "BPH/OABની દવા — આલ્ફા-બ્લૉકર, એન્ટિકોલિનર્જિક, beta-3.",
                "રાત્રિ-પોલીયુરિયામાં desmopressin (ડૉક્ટરની દેખરેખમાં).",
                "રાત્રિ લાઇટ + યુરિનલ પાસે રાખો.",
            ],
        },
    },
    {
        "id": "varicocele",
        "cover": _IMG_ANATOMY,
        "title": {
            "en": "Varicocele",
            "hi": "वेरिकोसील",
            "gu": "વેરિકોસીલ",
        },
        "summary": {
            "en": "Varicose veins in the scrotum — a common, correctable cause of male infertility.",
            "hi": "अंडकोष की नसों का फैलाव — पुरुष बांझपन का एक सामान्य ठीक होने वाला कारण।",
            "gu": "વૃષણની નસોનું ફુલાવું — પુરુષ વંધ્યત્વનું સામાન્ય, ઉપચાર્ય કારણ.",
        },
        "details": {
            "en": (
                "A varicocele is a dilation of the veins in the scrotum, usually on the left. It affects 15% of all men and 40% of infertile men. "
                "Symptoms include a 'bag of worms' feeling, scrotal heaviness on standing and reduced testicular size. "
                "Microsurgical subinguinal varicocelectomy is today's gold standard — 60–70% of couples conceive within a year of surgery. "
                "Not every varicocele needs surgery — indications are pain, testicular atrophy or abnormal semen parameters with infertility."
            ),
            "hi": (
                "वेरिकोसील अंडकोष की नसों का फैलाव है, प्राय: बाईं ओर। 15% पुरुषों और 40% बांझ पुरुषों में पाया जाता है। "
                "लक्षण: 'कीड़ों का थैला' जैसा अहसास, खड़े रहने पर भारीपन, अंडकोष का आकार कम होना। "
                "माइक्रोसर्जिकल सबइंग्वाइनल वेरिकोसेलेक्टमी स्वर्ण मानक — 60–70% दंपत्ति एक साल में गर्भधारण करते हैं। "
                "हर वेरिकोसील को सर्जरी नहीं चाहिए — दर्द, अंडकोष सिकुड़ना या असामान्य सीमन में।"
            ),
            "gu": (
                "વેરિકોસીલ એ વૃષણની નસોનું ફુલાવું છે, સામાન્ય રીતે ડાબી બાજુ. 15% પુરુષોમાં અને 40% વંધ્ય પુરુષોમાં જોવા મળે. "
                "લક્ષણ: 'કીડાઓની થેલી' જેવી લાગણી, ઊભા રહેવામાં ભાર, વૃષણ કદ ઘટવું. "
                "માઇક્રોસર્જિકલ સબ-ઇન્ગ્વિનલ વેરિકોસેલેક્ટમી ગોલ્ડ સ્ટાન્ડર્ડ — 60–70% દંપતી વર્ષમાં ગર્ભધારણ કરે છે. "
                "દરેક વેરિકોસીલને સર્જરી નથી જોઈતી — દુખાવો, વૃષણ સંકોચાવું કે અસામાન્ય સીમનમાં જ."
            ),
        },
        "steps": {
            "en": [
                "Examination is best done standing with a Valsalva manoeuvre.",
                "Scrotal Doppler ultrasound confirms the diagnosis.",
                "Infertile couple → semen analysis + hormone panel before deciding on surgery.",
                "Microsurgical subinguinal varicocelectomy = gold standard (lowest recurrence).",
                "Pain, testicular atrophy or abnormal semen are the main indications.",
                "Expect semen improvement over 3–6 months after surgery.",
            ],
            "hi": [
                "खड़े होकर वेलसाल्वा पर जाँच बेहतर।",
                "Scrotal Doppler USG से निदान।",
                "बांझ दंपति → सीमन विश्लेषण + हॉर्मोन; फिर सर्जरी निर्णय।",
                "माइक्रोसर्जिकल सबइंग्वाइनल वेरिकोसेलेक्टमी — सबसे कम दोबारा होना।",
                "मुख्य संकेत: दर्द, अंडकोष सिकुड़ना, असामान्य सीमन।",
                "3–6 महीने में सीमन सुधार दिखता है।",
            ],
            "gu": [
                "ઊભા રહી વૅલ્સાલ્વા સાથે તપાસ સારી.",
                "Scrotal Doppler USGથી નિદાન.",
                "વંધ્ય દંપતી → સીમન એનાલિસિસ + હોર્મોન; પછી સર્જરી.",
                "માઇક્રોસર્જિકલ સબ-ઇન્ગ્વિનલ — સૌથી ઓછું ફરી થવું.",
                "મુખ્ય સંકેત: દુખાવો, વૃષણ સંકોચાવું, અસામાન્ય સીમન.",
                "3–6 માસમાં સીમન સુધારો દેખાય.",
            ],
        },
    },
    {
        "id": "male-infertility",
        "cover": _IMG_FERTILITY,
        "title": {
            "en": "Male Infertility — First Workup",
            "hi": "पुरुष बांझपन — पहली जांच",
            "gu": "પુરુષ વંધ્યત્વ — પ્રથમ તપાસ",
        },
        "summary": {
            "en": "Male factors contribute to 40% of infertility — evaluation is simple and often fixable.",
            "hi": "बांझपन में 40% पुरुष कारण — मूल्यांकन सरल व अक्सर ठीक किया जा सकता है।",
            "gu": "વંધ્યત્વમાં 40% પુરુષ કારણ — મૂલ્યાંકન સરળ અને ઘણી વાર સુધારી શકાય.",
        },
        "details": {
            "en": (
                "After 12 months of unprotected intercourse without pregnancy, both partners need evaluation. The male workup starts with two semen analyses "
                "(WHO 2021 criteria) done 2–4 weeks apart, a physical examination and reproductive hormones (FSH, LH, testosterone, prolactin). "
                "Causes include varicocele, low testosterone, obstruction, genetic issues and lifestyle factors (smoking, obesity, heat exposure). "
                "Treatable causes should be addressed before jumping to IVF — it is often cheaper, faster and more successful."
            ),
            "hi": (
                "12 महीने असुरक्षित सहवास के बाद भी गर्भ न हो तो दोनों साथी की जाँच। पुरुष मूल्यांकन 2 सीमन विश्लेषण (2–4 सप्ताह के अंतराल), शारीरिक जाँच व हार्मोन (FSH, LH, टेस्टोस्टेरोन, प्रोलैक्टिन) से। "
                "कारण: वेरिकोसील, कम टेस्टोस्टेरोन, अवरोध, आनुवंशिक, जीवनशैली। IVF से पहले ठीक होने वाले कारणों का इलाज — सस्ता, तेज़ व सफल।"
            ),
            "gu": (
                "12 મહિના અસુરક્ષિત સંભોગ પછી પણ ગર્ભ ન થાય તો બંને ભાગીદારની તપાસ. પુરુષ મૂલ્યાંકન 2 સીમન એનાલિસિસ (2–4 અઠવાડિયાના અંતરે), શારીરિક તપાસ અને હોર્મોન (FSH, LH, ટેસ્ટોસ્ટેરોન, પ્રોલેક્ટિન). "
                "કારણો: વેરિકોસીલ, ઓછું ટેસ્ટોસ્ટેરોન, અવરોધ, જેનેટિક, જીવનશૈલી. IVF પહેલાં સુધારી શકાય તેવા કારણો — સસ્તું, ઝડપી, સફળ."
            ),
        },
        "steps": {
            "en": [
                "Book a semen analysis after 2–5 days of abstinence — confirm with a 2nd test.",
                "Hormone panel: FSH, LH, total testosterone, prolactin, TSH.",
                "Scrotal exam to check for varicocele, small testes or absent vas.",
                "Lifestyle: stop smoking, lose weight, avoid hot tubs/tight underwear, limit alcohol.",
                "Treat reversible causes (varicocele, low T, infection) before IVF.",
                "Genetic testing (karyotype, Y-micro-deletions) if severe oligo-/azoospermia.",
            ],
            "hi": [
                "2–5 दिन संयम के बाद सीमन विश्लेषण; दूसरा टेस्ट भी।",
                "हार्मोन: FSH, LH, टोटल टेस्टोस्टेरोन, प्रोलैक्टिन, TSH।",
                "वेरिकोसील, छोटे अंडकोष, वास अनुपस्थिति के लिए जांच।",
                "जीवनशैली: धूम्रपान बंद, वजन कम, गर्म स्नान/तंग अंडरवेयर नहीं, शराब सीमित।",
                "IVF से पहले वेरिकोसील, कम T, संक्रमण का इलाज।",
                "गंभीर ओलिगो/एज़ोस्पर्मिया में जेनेटिक टेस्ट।",
            ],
            "gu": [
                "2–5 દિવસ સંયમ પછી સીમન એનાલિસિસ; બીજો ટેસ્ટ પણ.",
                "હોર્મોન: FSH, LH, ટોટલ ટેસ્ટોસ્ટેરોન, પ્રોલેક્ટિન, TSH.",
                "વેરિકોસીલ, નાના વૃષણ, વાસ ગેરહાજર માટે તપાસ.",
                "જીવનશૈલી: ધૂમ્રપાન બંધ, વજન ઘટાડવું, ગરમ સ્નાન/ચુસ્ત અંડરવેર નહીં, દારૂ મર્યાદિત.",
                "IVF પહેલાં વેરિકોસીલ, નીચું T, ઇન્ફેક્શનનો ઇલાજ.",
                "ગંભીર ઓલિગો/એઝૂસ્પર્મિયામાં જેનેટિક ટેસ્ટ.",
            ],
        },
    },
    {
        "id": "low-testosterone",
        "cover": _IMG_HORMONE,
        "title": {
            "en": "Low Testosterone (Hypogonadism)",
            "hi": "कम टेस्टोस्टेरोन (हाइपोगोनैडिज़्म)",
            "gu": "નીચું ટેસ્ટોસ્ટેરોન (હાયપોગોનેડિઝમ)",
        },
        "summary": {
            "en": "Low energy, low libido and poor mood in men can be hormonal — and reversible.",
            "hi": "थकान, यौन इच्छा में कमी, मूड — कई बार हार्मोन कारण, इलाज संभव।",
            "gu": "થાક, યૌન ઇચ્છામાં ઘટાડો, મૂડ — ઘણી વાર હોર્મોન કારણ, ઇલાજ શક્ય.",
        },
        "details": {
            "en": (
                "Testosterone peaks in the 20s and drops ~1% per year after 40. Symptoms of low T include low libido, erectile dysfunction, fatigue, "
                "depressed mood, loss of muscle mass and increased belly fat. Diagnosis requires morning total testosterone <300 ng/dL on TWO occasions, "
                "with FSH/LH and prolactin. Treat lifestyle first: weight loss, resistance training, 7–8 hours sleep. Testosterone replacement (gel/injection) is "
                "safe when properly monitored — check haematocrit and PSA every 6 months."
            ),
            "hi": (
                "टेस्टोस्टेरोन 20 वर्ष में चरम पर, 40 के बाद ~1%/वर्ष घटता है। कम T के लक्षण: कम यौन इच्छा, ED, थकान, उदासी, मांसपेशियाँ कम, पेट की चर्बी। "
                "निदान: सुबह का टोटल टेस्टोस्टेरोन <300 ng/dL दो बार; FSH/LH, प्रोलैक्टिन। पहले जीवनशैली: वजन, रेज़िस्टेंस ट्रेनिंग, 7–8 घंटे नींद। "
                "टेस्टोस्टेरोन रिप्लेसमेंट (जेल/इंजेक्शन) सुरक्षित अगर 6 माह में PSA व हेमाटोक्रिट मॉनिटर हो।"
            ),
            "gu": (
                "ટેસ્ટોસ્ટેરોન 20માં શિખર પર, 40 પછી ~1%/વર્ષ ઘટે. નીચા Tના લક્ષણો: ઓછી યૌન ઇચ્છા, ED, થાક, ઉદાસી, સ્નાયુ ઘટે, પેટની ચરબી. "
                "નિદાન: સવારનો ટોટલ T <300 ng/dL બે વાર; FSH/LH, પ્રોલેક્ટિન. પહેલાં જીવનશૈલી: વજન, રેઝિસ્ટન્સ, 7–8 કલાક ઊંઘ. "
                "T રિપ્લેસમેન્ટ (જેલ/ઇન્જેક્શન) સલામત — 6 માસે PSA અને હેમાટોક્રિટ મોનિટર."
            ),
        },
        "steps": {
            "en": [
                "Morning total testosterone on 2 different days to confirm.",
                "Weight loss + resistance exercise 3×/week raises T by 10–15%.",
                "Sleep 7–8 hours — most T is produced during deep sleep.",
                "Avoid daily alcohol and minimise refined sugar intake.",
                "Testosterone replacement in confirmed deficiency with symptoms.",
                "Monitor haematocrit, PSA, mood and sleep apnoea on treatment.",
            ],
            "hi": [
                "सुबह टोटल T — 2 अलग दिन पुष्टि।",
                "वजन कम + हफ़्ते में 3 बार रेज़िस्टेंस → 10–15% वृद्धि।",
                "7–8 घंटे नींद।",
                "रोज़ाना शराब न लें; चीनी कम।",
                "कमी + लक्षण पर T रिप्लेसमेंट।",
                "इलाज में PSA, हेमाटोक्रिट, मूड, स्लीप एपनिया मॉनिटर।",
            ],
            "gu": [
                "સવારનું ટોટલ T — 2 અલગ દિવસે પુષ્ટિ.",
                "વજન ઘટાડો + અઠવાડિયે 3 વાર રેઝિસ્ટન્સ → 10–15% વધારો.",
                "7–8 કલાક ઊંઘ.",
                "રોજ દારૂ નહીં; ખાંડ ઓછી.",
                "ખામી + લક્ષણ હોય તો T રિપ્લેસમેન્ટ.",
                "ઇલાજમાં PSA, હેમાટોક્રિટ, મૂડ, સ્લીપ ઍપ્નિયા મોનિટર.",
            ],
        },
    },
    {
        "id": "peyronies-disease",
        "cover": _IMG_DR_CONSULT,
        "title": {
            "en": "Peyronie's Disease (Penile Curvature)",
            "hi": "Peyronie's रोग (लिंग का टेढ़ा होना)",
            "gu": "Peyronie's રોગ (લિંગનું વાંકુ થવું)",
        },
        "summary": {
            "en": "Painful erections and penile bend need early urology assessment for best outcome.",
            "hi": "दर्दनाक स्तंभन और लिंग का टेढ़ापन — जल्दी यूरोलॉजी जांच ज़रूरी।",
            "gu": "દુખાવાવાળું ઇરેક્શન અને લિંગ વાંકું — વહેલી યુરોલોજી તપાસ જરૂરી.",
        },
        "details": {
            "en": (
                "Peyronie's disease is a fibrous plaque that forms in the penile tunica, causing curvature, pain and sometimes erectile problems. "
                "The active phase (pain + changing shape) lasts 6–18 months; after that the plaque becomes stable. "
                "Early intervention with traction therapy, oral pentoxifylline and intralesional injections (collagenase, verapamil) can reduce curvature in the active phase. "
                "Surgery (plication or plaque excision with grafting) is reserved for stable disease with functional problems."
            ),
            "hi": (
                "Peyronie's में लिंग की ट्यूनिका में रेशेदार प्लाक बनती है — टेढ़ापन, दर्द, कभी-कभी स्तंभन समस्या। सक्रिय चरण 6–18 माह; फिर स्थिर। "
                "सक्रिय चरण में ट्रैक्शन थेरेपी, pentoxifylline, intralesional इंजेक्शन से टेढ़ापन कम। सर्जरी (plication / plaque excision + graft) स्थिर रोग में।"
            ),
            "gu": (
                "Peyronie'sમાં લિંગની ટ્યુનિકામાં તંતુમય પ્લાક બને — વાંકુ, દુખાવો, ક્યારેક ઇરેક્શન સમસ્યા. સક્રિય તબક્કો 6–18 માસ; પછી સ્થિર. "
                "સક્રિય તબક્કામાં ટ્રૅક્શન થેરેપી, pentoxifylline, intralesional ઇન્જેક્શન — વાંકું ઘટાડે. સર્જરી (પ્લિકેશન / પ્લાક છેદન + ગ્રાફ્ટ) સ્થિર રોગમાં."
            ),
        },
        "steps": {
            "en": [
                "Present early — active-phase treatments work best in the first 12 months.",
                "Penile traction device for 3–6 months reduces curvature by 10–20°.",
                "Oral pentoxifylline + vitamin E are commonly used adjuncts.",
                "Intralesional verapamil or collagenase injections for larger curvature.",
                "Surgery (plication / grafting / penile implant) for stable disease with >60° bend.",
                "Avoid manipulating or bending the erect penis — it can worsen the plaque.",
            ],
            "hi": [
                "जल्दी दिखाएँ — पहले 12 माह में सक्रिय इलाज सर्वश्रेष्ठ।",
                "पेनाइल ट्रैक्शन 3–6 माह — 10–20° कमी।",
                "Oral pentoxifylline + विटामिन E सामान्य सहायक।",
                "बड़े टेढ़ेपन में intralesional verapamil/collagenase।",
                "60°+ स्थिर टेढ़ेपन में सर्जरी/प्रत्यारोपण।",
                "स्तंभन में लिंग को मोड़ें नहीं — प्लाक बिगड़ सकती है।",
            ],
            "gu": [
                "વહેલાં બતાવો — 12 માસ સુધી સક્રિય ઇલાજ શ્રેષ્ઠ.",
                "પેનાઇલ ટ્રૅક્શન 3–6 માસ — 10–20° ઘટાડો.",
                "Pentoxifylline + વિટામિન E સહાયક.",
                "મોટા વાંકામાં intralesional verapamil/collagenase.",
                "60°+ સ્થિર વાંકામાં સર્જરી/ઇમ્પ્લાન્ટ.",
                "ઇરેક્ટ લિંગને વાળવું નહીં — પ્લાક બગડી શકે.",
            ],
        },
    },
    {
        "id": "prostatitis",
        "cover": _IMG_BPH,
        "title": {
            "en": "Prostatitis",
            "hi": "प्रोस्टेटाइटिस",
            "gu": "પ્રોસ્ટેટાઇટિસ",
        },
        "summary": {
            "en": "Pelvic pain, urinary frequency and painful ejaculation — chronic prostatitis is manageable.",
            "hi": "श्रोणि दर्द, बार-बार पेशाब, दर्दनाक स्खलन — क्रॉनिक प्रोस्टेटाइटिस नियंत्रित किया जा सकता है।",
            "gu": "પેલ્વિક દુખાવો, વારંવાર પેશાબ, દુખાવાવાળું સ્ખલન — ક્રોનિક પ્રોસ્ટેટાઇટિસ કાબૂમાં આવે છે.",
        },
        "details": {
            "en": (
                "Prostatitis is categorised into acute bacterial, chronic bacterial and chronic pelvic pain syndrome (most common). "
                "Acute prostatitis presents with fever and severe pain — an emergency needing IV antibiotics. "
                "Chronic pelvic pain responds to a multimodal approach: alpha-blockers + anti-inflammatories + pelvic floor physiotherapy + stress management. "
                "Traditional lengthy antibiotic courses rarely help chronic forms as most are non-bacterial."
            ),
            "hi": (
                "प्रोस्टेटाइटिस तीन प्रकार: तीव्र बैक्टीरियल, क्रॉनिक बैक्टीरियल, क्रॉनिक पेल्विक पेन सिंड्रोम (सबसे आम)। "
                "तीव्र में बुखार व तेज़ दर्द — आपातकाल, IV एंटीबायोटिक। क्रॉनिक पेल्विक पेन में मल्टीमॉडल — अल्फा-ब्लॉकर + एंटी-इन्फ्लेमेटरी + पेल्विक फ्लोर फिज़ियो + तनाव प्रबंधन। "
                "लंबा एंटीबायोटिक कोर्स क्रॉनिक में शायद ही फायदा करता है।"
            ),
            "gu": (
                "પ્રોસ્ટેટાઇટિસના ત્રણ પ્રકાર: તીવ્ર બૅક્ટેરિયલ, ક્રોનિક બૅક્ટેરિયલ, ક્રોનિક પેલ્વિક પેઇન સિન્ડ્રોમ (સૌથી સામાન્ય). "
                "તીવ્રમાં તાવ અને તીવ્ર દુખાવો — ઇમર્જન્સી, IV એન્ટિબાયોટિક. ક્રોનિક પેલ્વિક પેઇનમાં મલ્ટિમોડલ — આલ્ફા-બ્લૉકર + એન્ટિ-ઇન્ફ્લેમેટરી + પેલ્વિક ફ્લોર ફિઝિયો + સ્ટ્રેસ મેનેજમેન્ટ."
            ),
        },
        "steps": {
            "en": [
                "Acute fever + perineal pain → ER / admission for IV antibiotics.",
                "Chronic symptoms → urine culture, expressed prostatic secretion culture.",
                "Alpha-blockers relax bladder neck and reduce pelvic pain.",
                "Pelvic-floor physiotherapy & stress reduction are highly effective.",
                "Avoid prolonged sitting, cycling and spicy food during flares.",
                "Long-term antibiotics only if bacterial source confirmed.",
            ],
            "hi": [
                "तीव्र बुखार + पेरिनियल दर्द → अस्पताल, IV एंटीबायोटिक।",
                "क्रॉनिक → urine culture, EPS culture।",
                "अल्फा-ब्लॉकर से मूत्राशय गर्दन ढीली, दर्द कम।",
                "पेल्विक फ्लोर फिज़ियो व तनाव कम — बहुत प्रभावी।",
                "भड़कने पर लंबा बैठना, साइकिलिंग, मसाले कम।",
                "लंबा एंटीबायोटिक केवल बैक्टीरिया मिलने पर।",
            ],
            "gu": [
                "તીવ્ર તાવ + પેરિનિયલ દુખાવો → હૉસ્પિટલ, IV એન્ટિબાયોટિક.",
                "ક્રોનિક → urine culture, EPS culture.",
                "આલ્ફા-બ્લૉકરથી મૂત્રાશય ગળું ઢીલું, દુખાવો ઘટે.",
                "પેલ્વિક ફ્લોર ફિઝિયો અને સ્ટ્રેસ ઘટાડવું — અસરકારક.",
                "ભડકે ત્યારે લાંબું બેસવું, સાયકલિંગ, મસાલો ઓછો.",
                "લાંબી એન્ટિબાયોટિક માત્ર બૅક્ટેરિયા મળે તો.",
            ],
        },
    },
    {
        "id": "urethral-stricture",
        "cover": _IMG_LAPARO,
        "title": {
            "en": "Urethral Stricture",
            "hi": "मूत्रमार्ग संकुचन",
            "gu": "યુરેથ્રલ સ્ટ્રિક્ચર",
        },
        "summary": {
            "en": "A thin urinary stream and straining to urinate can mean stricture — beyond BPH.",
            "hi": "पतली पेशाब की धार व ज़ोर लगाना — BPH के अलावा stricture हो सकता है।",
            "gu": "પાતળું પેશાબનું સ્ટ્રીમ અને બળ લગાવવું — BPH ઉપરાંત stricture પણ હોઈ શકે.",
        },
        "details": {
            "en": (
                "A urethral stricture is a narrowed segment of the urethra, most often caused by previous catheterisation, trauma or infection. "
                "Diagnosis needs uroflowmetry and retrograde urethrogram. Short strictures (<1 cm) can be treated with optical urethrotomy; "
                "longer or recurrent strictures need urethroplasty — a reconstructive surgery with durable 90%+ success rate. "
                "Repeated blind dilatation for recurrent stricture only causes more scarring — always seek a urologist's opinion."
            ),
            "hi": (
                "मूत्रमार्ग संकुचन (stricture) मूत्रमार्ग का संकीर्ण हिस्सा है — कारण: कैथेटर, आघात या संक्रमण। निदान uroflowmetry + retrograde urethrogram। "
                "1 cm से छोटी में optical urethrotomy; लंबी या बार-बार होने वाली में urethroplasty — 90%+ स्थायी सफलता। "
                "बार-बार dilatation निशान बढ़ाती है — यूरोलॉजिस्ट की राय ज़रूरी।"
            ),
            "gu": (
                "યુરેથ્રલ stricture એ મૂત્રમાર્ગનો સંકુચિત ભાગ છે — કારણ: કૅથેટર, ઇજા કે ઇન્ફેક્શન. નિદાન uroflowmetry + retrograde urethrogram. "
                "1 સે.મી.થી ટૂંકીમાં optical urethrotomy; લાંબી કે વારંવાર થતીમાં urethroplasty — 90%+ સ્થાયી સફળતા. "
                "વારંવાર dilatation વધુ નિશાન બનાવે — યુરોલોજિસ્ટનો અભિપ્રાય જરૂરી."
            ),
        },
        "steps": {
            "en": [
                "Uroflowmetry: plateau pattern suggests stricture.",
                "Retrograde urethrogram maps the site and length of narrowing.",
                "Optical urethrotomy for <1 cm short single strictures.",
                "Urethroplasty (buccal mucosa graft) for longer or recurrent strictures.",
                "Avoid repeated blind dilatations — they worsen scarring.",
                "Follow-up uroflowmetry at 3, 6 and 12 months after surgery.",
            ],
            "hi": [
                "Uroflowmetry plateau — stricture का संकेत।",
                "Retrograde urethrogram — स्थान व लंबाई।",
                "<1 cm में optical urethrotomy।",
                "लंबी/बार-बार होने पर urethroplasty (buccal mucosa graft)।",
                "बार-बार dilatation नहीं — निशान बढ़ते हैं।",
                "सर्जरी के बाद 3, 6, 12 माह पर uroflowmetry।",
            ],
            "gu": [
                "Uroflowmetry plateau — strictureનો સંકેત.",
                "Retrograde urethrogram — સ્થળ અને લંબાઈ.",
                "<1 સે.મી.માં optical urethrotomy.",
                "લાંબી/વારંવાર થતી હોય તો urethroplasty (buccal mucosa graft).",
                "વારંવાર dilatation નહીં — નિશાન વધે.",
                "સર્જરી પછી 3, 6, 12 માસે uroflowmetry.",
            ],
        },
    },
    {
        "id": "eswl-shockwave",
        "cover": _IMG_SHOCKWAVE,
        "title": {
            "en": "ESWL (Shock Wave Lithotripsy)",
            "hi": "ESWL (शॉक-वेव लिथोट्रिप्सी)",
            "gu": "ESWL (શોક-વેવ લિથોટ્રિપ્સી)",
        },
        "summary": {
            "en": "Non-invasive external shock waves to break kidney stones up to 2 cm.",
            "hi": "2 सेमी तक की गुर्दे की पथरी को बाहरी शॉक-वेव से तोड़ना — बिना चीरा।",
            "gu": "2 સે.મી. સુધીની કિડની પથરી બાહ્ય શોક-વેવથી તોડવું — ચીરા વગર.",
        },
        "details": {
            "en": (
                "ESWL uses focused shock waves generated outside the body to fragment kidney stones, which then pass naturally in urine over 2–4 weeks. "
                "Best results are seen with stones under 2 cm in the kidney or upper ureter. Stone-free rate is 70–80% — lower for hard stones (cystine, brushite). "
                "Post-procedure, mild haematuria and flank pain are expected. Avoid ESWL in pregnancy, bleeding disorders, uncontrolled BP, and aortic aneurysm. "
                "Newer flexible ureteroscopy (RIRS) has similar success with single-session certainty — preferred for stones 1–2 cm."
            ),
            "hi": (
                "ESWL में शरीर के बाहर उत्पन्न शॉक-वेव से गुर्दे की पथरी टूटती है और 2–4 सप्ताह में पेशाब में निकल जाती है। "
                "2 cm तक गुर्दे/ऊपरी मूत्रवाहिनी की पथरी में सर्वोत्तम — 70–80% stone-free, कठोर पथरी (cystine, brushite) में कम। "
                "हल्का खून और कमर दर्द सामान्य। गर्भावस्था, रक्तस्राव रोग, अनियंत्रित BP, एओर्टिक एन्युरिज़्म में न करें। "
                "1–2 cm में RIRS बेहतर — एक सत्र में निश्चित।"
            ),
            "gu": (
                "ESWLમાં શરીર બહારના શૉક-વેવથી કિડની પથરી તૂટે અને 2–4 અઠવાડિયામાં પેશાબમાં નીકળે. "
                "2 સે.મી. સુધીની કિડની/ઉપલી મૂત્રવાહિની પથરીમાં શ્રેષ્ઠ — 70–80% stone-free; કઠણ પથરી (cystine, brushite)માં ઓછું. "
                "હળવું લોહી અને કમરનો દુખાવો સામાન્ય. ગર્ભાવસ્થા, બ્લીડિંગ રોગ, અનિયંત્રિત BP, એઓર્ટિક એન્યુરિઝમમાં ન કરવું. "
                "1–2 સે.મી.માં RIRS વધુ સારું — એક સત્રમાં ચોક્કસ."
            ),
        },
        "steps": {
            "en": [
                "ESWL is a day-care procedure under sedation — no cuts, no stitches.",
                "Drink 2–3 L water/day for 4 weeks to help fragments pass.",
                "Take prescribed tamsulosin to relax the ureter and aid stone passage.",
                "Mild pink urine and flank discomfort are normal for 1 week.",
                "Report fever, heavy bleeding or inability to pass urine.",
                "Follow-up X-ray or USG at 4 weeks to confirm stone clearance.",
            ],
            "hi": [
                "ESWL — सिडेशन में डे-केयर; न चीरा न टाँके।",
                "4 सप्ताह 2–3 लीटर पानी — टुकड़े निकलने में मदद।",
                "तमसुलोसिन ureter ढीली करे व पथरी निकलने में सहायक।",
                "1 सप्ताह हल्का गुलाबी पेशाब व दर्द सामान्य।",
                "बुखार, ज़्यादा खून, पेशाब रुक जाए तो बताइए।",
                "4 सप्ताह बाद X-ray/USG से पुष्टि।",
            ],
            "gu": [
                "ESWL — સિડેશનમાં ડે-કેર; ચીરો કે ટાંકા નહીં.",
                "4 અઠવાડિયાં 2–3 લિટર પાણી — ટુકડા નીકળવામાં મદદ.",
                "તમસુલોસિન ureter ઢીલી કરી પથરી કાઢવામાં મદદ.",
                "1 અઠવાડિયું હળવું ગુલાબી પેશાબ અને દુખાવો સામાન્ય.",
                "તાવ, વધુ લોહી, પેશાબ અટકે તો જણાવો.",
                "4 અઠવાડિયે X-ray/USGથી પુષ્ટિ.",
            ],
        },
    },
    {
        "id": "rirs-flexible-ureteroscopy",
        "cover": _IMG_LAPARO,
        "title": {
            "en": "RIRS / Flexible Ureteroscopy",
            "hi": "RIRS / फ्लेक्सिबल यूरेटरोस्कोपी",
            "gu": "RIRS / ફ્લેક્સિબલ યુરેટરોસ્કોપી",
        },
        "summary": {
            "en": "Scarless laser stone surgery through the natural urinary passage.",
            "hi": "प्राकृतिक मूत्रमार्ग से लेज़र से पथरी — बिना निशान सर्जरी।",
            "gu": "કુદરતી મૂત્રમાર્ગથી લેઝર સ્ટોન સર્જરી — નિશાન વગર.",
        },
        "details": {
            "en": (
                "RIRS (Retrograde Intrarenal Surgery) uses a flexible ureteroscope passed through the urethra up into the kidney to laser-fragment stones. "
                "No external cut, no bleeding, day-care discharge for most patients. It is the procedure of choice for kidney stones 1–2 cm, lower-pole stones, "
                "bleeding disorders, obesity and children. Stone-free rate is 85–95% in a single session. A temporary DJ stent is placed for 1–2 weeks."
            ),
            "hi": (
                "RIRS में फ्लेक्सिबल यूरेटरोस्कोप मूत्रमार्ग से गुर्दे तक जाता है व लेज़र से पथरी तोड़ता है। कोई बाहरी चीरा नहीं, रक्तस्राव नहीं, अधिकांश डे-केयर। "
                "1–2 cm, निचले ध्रुव की पथरी, रक्तस्राव रोग, मोटापा, बच्चों में पसंद। एक सत्र में 85–95% stone-free; 1–2 सप्ताह के लिए DJ स्टेंट।"
            ),
            "gu": (
                "RIRSમાં ફ્લેક્સિબલ યુરેટરોસ્કોપ મૂત્રમાર્ગથી કિડની સુધી જઈ લેઝરથી પથરી તોડે. બાહ્ય ચીરો નહીં, લોહી નહીં, મોટાભાગના ડે-કેર. "
                "1–2 સે.મી., નીચેના ધ્રુવની પથરી, બ્લીડિંગ ડિસઓર્ડર, સ્થૂળતા, બાળકોમાં પસંદ. એક સત્રમાં 85–95% stone-free; 1–2 અઠવાડિયે DJ સ્ટેન્ટ."
            ),
        },
        "steps": {
            "en": [
                "General/spinal anaesthesia, typical duration 45–90 minutes.",
                "Flexible scope through urethra → bladder → ureter → kidney.",
                "Holmium or Thulium fibre laser fragments the stone.",
                "DJ stent placed for 1–2 weeks to prevent obstruction.",
                "Return to work in 2–3 days; avoid heavy lifting for 2 weeks.",
                "Schedule stent removal within 2 weeks — never forget!",
            ],
            "hi": [
                "जनरल/स्पाइनल एनेस्थीसिया; 45–90 मिनट।",
                "फ्लेक्सिबल स्कोप मूत्रमार्ग → मूत्राशय → मूत्रवाहिनी → गुर्दा।",
                "Holmium/Thulium फ़ाइबर लेज़र से पथरी टूटती है।",
                "1–2 सप्ताह DJ स्टेंट — अवरोध रोकने के लिए।",
                "2–3 दिन में काम पर; 2 सप्ताह भारी न उठाएँ।",
                "2 सप्ताह में स्टेंट निकलवाएँ — कभी न भूलें।",
            ],
            "gu": [
                "જનરલ/સ્પાઇનલ એનેસ્થેસિયા; 45–90 મિનિટ.",
                "ફ્લેક્સિબલ સ્કોપ મૂત્રમાર્ગ → મૂત્રાશય → યુરેટર → કિડની.",
                "Holmium/Thulium ફાઇબર લેઝરથી પથરી તૂટે.",
                "1–2 અઠવાડિયાં DJ સ્ટેન્ટ — અવરોધ રોકવા.",
                "2–3 દિવસમાં કામ પર; 2 અઠવાડિયાં ભારે નહીં.",
                "2 અઠવાડિયામાં સ્ટેન્ટ કઢાવો — ક્યારેય ન ભૂલો.",
            ],
        },
    },
    {
        "id": "turp-holep-bph",
        "cover": _IMG_SURGERY_ROOM,
        "title": {
            "en": "TURP & HoLEP for BPH",
            "hi": "BPH के लिए TURP व HoLEP",
            "gu": "BPH માટે TURP અને HoLEP",
        },
        "summary": {
            "en": "Surgical options for prostate enlargement when medicines aren't enough.",
            "hi": "दवा पर्याप्त न हो तो बढ़े प्रोस्टेट के सर्जिकल विकल्प।",
            "gu": "દવા પર્યાપ્ત ન હોય તો મોટા પ્રોસ્ટેટ માટે સર્જિકલ વિકલ્પો.",
        },
        "details": {
            "en": (
                "Surgery for BPH is indicated when medication fails, urinary retention recurs, bladder stones form, kidney function declines, or there is recurrent bleeding. "
                "TURP (bipolar/saline) has been the reference standard for decades — excellent in prostates up to 80 g. "
                "HoLEP (Holmium Laser Enucleation) removes almost the entire adenoma — superior for prostates >80 g with very low bleeding risk, same-day catheter removal possible. "
                "Both preserve erections in >90% of men but cause retrograde ejaculation (dry orgasm) in 70–90%. Urinary continence is preserved in >99%."
            ),
            "hi": (
                "BPH सर्जरी तब ज़रूरी: दवा विफल, बार-बार पेशाब रुक जाना, मूत्राशय पथरी, गुर्दे पर असर, बार-बार खून आना। "
                "TURP (bipolar/saline) दशकों से संदर्भ मानक — 80 ग्राम तक उत्तम। HoLEP (होलमियम लेज़र) से लगभग पूरा ऐडेनोमा निकलता है — 80 ग्राम से बड़े प्रोस्टेट में श्रेष्ठ, खून बहुत कम, कैथेटर जल्दी हटा। "
                "दोनों में 90%+ स्तंभन सुरक्षित; 70–90% में dry orgasm; 99%+ में निरंतरता सुरक्षित।"
            ),
            "gu": (
                "BPH સર્જરી જ્યારે જરૂરી: દવા નિષ્ફળ, વારંવાર પેશાબ અટકવું, મૂત્રાશય પથરી, કિડની પર અસર, વારંવાર લોહી. "
                "TURP (bipolar/saline) દાયકાઓથી પ્રમાણ — 80 ગ્રામ સુધી ઉત્તમ. HoLEP (હોલમિયમ લેઝર)થી લગભગ આખું એડિનોમા નીકળે — 80 ગ્રામથી મોટા પ્રોસ્ટેટમાં શ્રેષ્ઠ, ઓછું લોહી, કૅથેટર જલ્દી કઢાય. "
                "બંનેમાં 90%+ ઇરેક્શન સુરક્ષિત; 70–90%માં dry orgasm; 99%+માં કંટિનન્સ સુરક્ષિત."
            ),
        },
        "steps": {
            "en": [
                "Pre-op: MRI or USG for prostate size + flow studies + PSA.",
                "Stop blood thinners per urologist's plan.",
                "Hospital stay: 1–2 nights for TURP, 0–1 night for HoLEP.",
                "Catheter for 1–3 days; expect pink urine for up to 2 weeks.",
                "Avoid heavy lifting and cycling for 4 weeks.",
                "Retrograde ejaculation ('dry orgasm') is common — it does not affect pleasure.",
            ],
            "hi": [
                "प्री-ऑप: प्रोस्टेट आकार MRI/USG + flow + PSA।",
                "यूरोलॉजिस्ट की योजना से ब्लड थिनर बंद।",
                "अस्पताल: TURP 1–2 रात, HoLEP 0–1 रात।",
                "कैथेटर 1–3 दिन; 2 सप्ताह गुलाबी पेशाब।",
                "4 सप्ताह भारी सामान, साइकिल नहीं।",
                "Retrograde ejaculation सामान्य — आनंद कम नहीं होता।",
            ],
            "gu": [
                "પ્રી-ઑપ: પ્રોસ્ટેટ કદ MRI/USG + flow + PSA.",
                "યુરોલોજિસ્ટની યોજના મુજબ બ્લડ થિનર બંધ.",
                "હૉસ્પિટલ: TURP 1–2 રાત, HoLEP 0–1 રાત.",
                "કૅથેટર 1–3 દિવસ; 2 અઠવાડિયાં ગુલાબી પેશાબ.",
                "4 અઠવાડિયાં ભારે સામાન, સાયકલ નહીં.",
                "Retrograde ejaculation સામાન્ય — આનંદ ઘટતો નથી.",
            ],
        },
    },
    {
        "id": "paediatric-bedwetting",
        "cover": _IMG_CHILD,
        "title": {
            "en": "Childhood Bedwetting (Enuresis)",
            "hi": "बच्चों में बिस्तर गीला करना (Enuresis)",
            "gu": "બાળકોમાં પથારી ભીની કરવી (Enuresis)",
        },
        "summary": {
            "en": "Most children outgrow bedwetting — simple steps make bedtime dry and stress-free.",
            "hi": "अधिकांश बच्चे बिस्तर गीला करना स्वयं छोड़ देते हैं; सरल उपायों से रात सूखी व तनाव-मुक्त।",
            "gu": "મોટાભાગના બાળકો પથારી ભીની કરવી જાતે છોડી દે છે; સરળ પગલાંથી રાત કોરી અને તણાવ-મુક્ત.",
        },
        "details": {
            "en": (
                "Bedwetting is normal up to age 5 and affects 10% of 7-year-olds. 15% of affected children become dry each year on their own. "
                "Never punish or shame the child — this worsens the problem. Workup starts with a bladder diary, urine test and ultrasound. "
                "First-line therapy is the bedwetting alarm (highest long-term cure rate) combined with fluid restriction after dinner. "
                "Desmopressin tablets at bedtime are effective for special occasions (camps, overnight stays). Refer to a paediatric urologist if daytime wetting, UTIs or constipation coexist."
            ),
            "hi": (
                "5 वर्ष तक बिस्तर गीला करना सामान्य है; 7 वर्ष के 10% बच्चों में। हर साल 15% बच्चे स्वयं ठीक हो जाते हैं। "
                "डाँटें-शर्मिंदा न करें — समस्या बढ़ती है। जाँच: bladder diary, urine test, अल्ट्रासाउंड। "
                "पहली पंक्ति: bedwetting alarm (सबसे अच्छी दीर्घकालीन सफलता) + रात के खाने के बाद पानी कम। "
                "विशेष अवसरों के लिए desmopressin गोली। यदि दिन में गीलापन/UTI/कब्ज हो तो पेडियाट्रिक यूरोलॉजिस्ट के पास भेजें।"
            ),
            "gu": (
                "5 વર્ષ સુધી પથારી ભીની કરવી સામાન્ય; 7 વર્ષના 10% બાળકોમાં. દર વર્ષે 15% બાળકો જાતે સ્વસ્થ થાય. "
                "ઠપકો-શરમ ન આપવી — સમસ્યા વધે. તપાસ: bladder diary, urine test, USG. "
                "પ્રથમ હરોળ: bedwetting alarm (સૌથી સારી લાંબા ગાળાની સફળતા) + જમ્યા પછી પાણી ઓછું. "
                "ખાસ પ્રસંગોમાં desmopressin ગોળી. દિવસે ભીનાશ/UTI/કબજિયાત હોય તો પેડિયાટ્રિક યુરોલોજિસ્ટ પાસે."
            ),
        },
        "steps": {
            "en": [
                "Never punish — this is a developmental issue, not a behaviour.",
                "Limit fluids after dinner; void just before bed (double-void).",
                "Treat constipation first — it often resolves bedwetting alone.",
                "Bedwetting alarm for 8–16 weeks — highest long-term cure rate.",
                "Desmopressin tablet for camps/overnight stays (short-term use).",
                "Daytime wetting, UTIs or pain → see a paediatric urologist.",
            ],
            "hi": [
                "डाँटें नहीं — यह विकासात्मक है, आदत नहीं।",
                "रात के खाने के बाद पानी कम; सोने से पहले 2 बार पेशाब।",
                "पहले कब्ज ठीक करें — कई बार यही काफी।",
                "Bedwetting alarm 8–16 सप्ताह — सबसे बेहतर।",
                "कैंप/रात के लिए desmopressin (अल्पावधि)।",
                "दिन में गीलापन/UTI/दर्द → पेडियाट्रिक यूरोलॉजिस्ट।",
            ],
            "gu": [
                "ઠપકો નહીં — આ વિકાસ છે, આદત નહીં.",
                "જમ્યા પછી પાણી ઓછું; સૂતા પહેલાં 2 વાર પેશાબ.",
                "પહેલાં કબજિયાત મટાડો — ઘણી વાર પૂરતું.",
                "Bedwetting alarm 8–16 અઠવાડિયાં — શ્રેષ્ઠ.",
                "કૅમ્પ/રાત માટે desmopressin (ટૂંકા ગાળા).",
                "દિવસે ભીનાશ/UTI/દુખાવો → પેડિયાટ્રિક યુરોલોજિસ્ટ.",
            ],
        },
    },
    {
        "id": "diet-for-urology",
        "cover": _IMG_DIET,
        "title": {
            "en": "Urology-Friendly Diet",
            "hi": "यूरोलॉजी के अनुकूल आहार",
            "gu": "યુરોલોજી-ફ્રેન્ડલી આહાર",
        },
        "summary": {
            "en": "What to eat for a healthy prostate, strong kidneys and a calm bladder.",
            "hi": "स्वस्थ प्रोस्टेट, मजबूत गुर्दे और शांत मूत्राशय के लिए क्या खाएँ।",
            "gu": "સ્વસ્થ પ્રોસ્ટેટ, મજબૂત કિડની અને શાંત મૂત્રાશય માટે શું ખાવું.",
        },
        "details": {
            "en": (
                "A plant-forward, Mediterranean-style diet is consistently linked to lower rates of kidney stones, BPH progression and prostate cancer. "
                "Eat tomatoes (lycopene), leafy greens (folate), nuts (zinc, selenium), oily fish (omega-3) and green tea daily. "
                "Limit red meat, processed foods, added salt and sugary drinks. For stone formers, DO NOT cut calcium — take it with meals; do cut salt. "
                "Diabetic patients — tight glycaemic control halves the risk of bladder and nerve complications."
            ),
            "hi": (
                "पौध-आधारित, भूमध्यसागरीय शैली का आहार — पथरी, BPH व प्रोस्टेट कैंसर में कमी से जुड़ा है। "
                "रोज़ टमाटर (lycopene), हरी सब्जियाँ (folate), मेवे (जिंक, सेलेनियम), तैलीय मछली (omega-3), ग्रीन-टी। "
                "रेड मीट, प्रोसेस्ड खाद्य, अतिरिक्त नमक, मीठे पेय कम। पथरी के रोगी — कैल्शियम बंद न करें, भोजन के साथ लें; नमक कम। "
                "डायबिटीज में अच्छा नियंत्रण → मूत्राशय व नसों की जटिलताएँ आधी।"
            ),
            "gu": (
                "પ્લાન્ટ-આધારિત, મેડિટરેનિયન શૈલીનો આહાર — પથરી, BPH, પ્રોસ્ટેટ કૅન્સરમાં ઘટાડા સાથે જોડાયેલો. "
                "રોજ ટામેટાં (lycopene), લીલા શાક (folate), મેવો (જિંક, સેલેનિયમ), તેલી માછલી (omega-3), ગ્રીન-ટી. "
                "રેડ મીટ, પ્રોસેસ્ડ ખાદ્ય, વધુ મીઠું, મીઠા પીણાં ઓછા. પથરીના દર્દી — કૅલ્શિયમ બંધ ન કરો, ભોજન સાથે લો; મીઠું ઓછું. "
                "ડાયાબિટિસમાં સારું નિયંત્રણ → મૂત્રાશય-નસોની જટિલતા અડધી."
            ),
        },
        "steps": {
            "en": [
                "5 servings of fruits and vegetables daily — aim for a rainbow plate.",
                "Include tomatoes, leafy greens, nuts, oily fish and olive oil.",
                "Limit red and processed meat to once a week.",
                "Keep salt under 5 g/day; sugar under 25 g/day.",
                "Drink 2.5–3 L water; green tea 2 cups/day if no bladder irritation.",
                "Maintain BMI 22–25 and keep HbA1c <7% if diabetic.",
            ],
            "hi": [
                "रोज़ 5 सर्विंग फल-सब्ज़ी — रंग-बिरंगी थाली।",
                "टमाटर, हरी पत्तेदार, मेवे, तैलीय मछली, जैतून तेल।",
                "रेड/प्रोसेस्ड मीट हफ्ते में 1 बार।",
                "नमक <5 g/दिन, चीनी <25 g/दिन।",
                "2.5–3 L पानी; 2 कप ग्रीन टी।",
                "BMI 22–25; मधुमेह में HbA1c <7%।",
            ],
            "gu": [
                "રોજ 5 સર્વિંગ ફળ-શાક — રંગીન થાળી.",
                "ટામેટાં, લીલી શાક, મેવો, તેલી માછલી, ઓલિવ તેલ.",
                "રેડ/પ્રોસેસ્ડ મીટ અઠવાડિયે 1 વાર.",
                "મીઠું <5 g/દિવસ, ખાંડ <25 g/દિવસ.",
                "2.5–3 L પાણી; 2 કપ ગ્રીન ટી.",
                "BMI 22–25; ડાયાબિટિસમાં HbA1c <7%.",
            ],
        },
    },
    {
        "id": "exercise-urology",
        "cover": _IMG_EXERCISE,
        "title": {
            "en": "Exercise & Urinary Health",
            "hi": "व्यायाम व मूत्र स्वास्थ्य",
            "gu": "કસરત અને મૂત્ર આરોગ્ય",
        },
        "summary": {
            "en": "150 minutes of moderate exercise weekly protects kidneys, prostate and erections.",
            "hi": "हफ़्ते में 150 मिनट मध्यम व्यायाम — गुर्दे, प्रोस्टेट व स्तंभन की रक्षा।",
            "gu": "અઠવાડિયે 150 મિનિટ મધ્યમ કસરત — કિડની, પ્રોસ્ટેટ અને ઇરેક્શન રક્ષા.",
        },
        "details": {
            "en": (
                "Sedentary men have 30% higher BPH progression, 40% higher ED risk and slower recovery after urology surgery. "
                "A combination of aerobic (brisk walking, cycling, swimming) and resistance training gives best results. "
                "Avoid prolonged cycling if you have chronic perineal pain or post-vasectomy discomfort. "
                "After prostate surgery, Kegels + walking start from day 1, gym lifts from 4 weeks. Always hydrate adequately during exercise to protect the kidneys."
            ),
            "hi": (
                "गतिहीन पुरुषों में BPH बढ़ने की संभावना 30% अधिक, ED का जोखिम 40% अधिक और सर्जरी के बाद रिकवरी धीमी। "
                "एरोबिक (तेज चलना, साइकिलिंग, तैराकी) + रेज़िस्टेंस का मेल सर्वोत्तम। पुराना पेरिनियल दर्द/vasectomy के बाद असुविधा हो तो लंबी साइकिलिंग नहीं। "
                "प्रोस्टेट सर्जरी के बाद पहले दिन से केगल + चलना; 4 सप्ताह बाद जिम। व्यायाम के दौरान पर्याप्त पानी — गुर्दे की रक्षा।"
            ),
            "gu": (
                "બેઠાડુ પુરુષોમાં BPH વધવાની સંભાવના 30% વધુ, ED જોખમ 40% વધુ, સર્જરી પછી રિકવરી ધીમી. "
                "ઍરોબિક (ઝડપી ચાલ, સાયકલ, તરવું) + રેઝિસ્ટન્સ શ્રેષ્ઠ. જૂનો પેરિનિયલ દુખાવો/vasectomy પછી અસ્વસ્થતામાં લાંબી સાયકલ નહીં. "
                "પ્રોસ્ટેટ સર્જરી પછી પ્રથમ દિવસથી કેગલ + ચાલ; 4 અઠવાડિયે જીમ. કસરત દરમિયાન પૂરતું પાણી — કિડની રક્ષા."
            ),
        },
        "steps": {
            "en": [
                "150 min/week moderate aerobic + 2 sessions of resistance training.",
                "Add 10 min Kegel exercises daily for pelvic floor strength.",
                "Avoid long cycling if you have perineal pain or varicocele.",
                "Hydrate: 500 mL water 1 hour before, 250 mL every 20 min during.",
                "After surgery: walk from day 1, lift weights after 4 weeks.",
                "Monitor BP and heart rate — especially if diabetic or hypertensive.",
            ],
            "hi": [
                "हफ़्ते 150 मिनट एरोबिक + 2 सत्र रेज़िस्टेंस।",
                "10 मिनट रोज़ केगल — पेल्विक शक्ति।",
                "पेरिनियल दर्द/वेरिकोसील में लंबी साइकिलिंग नहीं।",
                "पानी: 1 घंटे पहले 500 mL, हर 20 मिनट में 250 mL।",
                "सर्जरी के बाद पहले दिन से चलें; 4 सप्ताह बाद भार।",
                "BP और हृदय गति मॉनिटर करें।",
            ],
            "gu": [
                "અઠવાડિયે 150 મિનિટ ઍરોબિક + 2 સત્ર રેઝિસ્ટન્સ.",
                "10 મિનિટ રોજ કેગલ — પેલ્વિક શક્તિ.",
                "પેરિનિયલ દુખાવો/વેરિકોસીલમાં લાંબી સાયકલ નહીં.",
                "પાણી: 1 કલાક પહેલાં 500 mL, દર 20 મિનિટે 250 mL.",
                "સર્જરી પછી પ્રથમ દિવસથી ચાલ; 4 અઠવાડિયે વજન.",
                "BP અને હૃદય ધબકારા મોનિટર.",
            ],
        },
    },
]


def localize(item: Dict[str, Any], lang: str) -> Dict[str, Any]:
    """Return a single-language shape for the client.

    Falls back to English when a language key is missing.
    Output shape matches the legacy contract: {id, cover, title, summary, details, steps[]}
    """
    def pick(block: Any) -> Any:
        if isinstance(block, dict):
            return block.get(lang) or block.get("en") or next(iter(block.values()), "")
        return block

    return {
        "id": item["id"],
        "cover": item.get("cover", ""),
        "title": pick(item.get("title", "")),
        "summary": pick(item.get("summary", "")),
        "details": pick(item.get("details", "")),
        "steps": pick(item.get("steps", [])) or [],
    }


def list_localized(lang: str) -> List[Dict[str, Any]]:
    return [localize(it, lang) for it in EDUCATION]


def get_localized(eid: str, lang: str) -> Dict[str, Any] | None:
    for it in EDUCATION:
        if it["id"] == eid:
            return localize(it, lang)
    return None
