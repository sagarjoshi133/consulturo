"""
ConsultUro — Surgical Consent Templates Database (Part 2 / 40 procedures)

Continuation of consent_procedures.py — these are the next 40 most-
commonly-performed urology procedures across the 8 procedural
categories. Same structure as Part 1: each procedure carries
trilingual (EN/HI/GU) name, procedure description, specific risks,
and alternatives.

Stored as a separate file so each module stays under 1000 lines for
code-review friendliness.
"""
from typing import Dict, List, Any


# Helper to build short trilingual snippet maps without ceremonial
# repetition of the same key dict 200+ times.
def _t(en: str, hi: str, gu: str) -> Dict[str, str]:
    return {"en": en, "hi": hi, "gu": gu}


PROCEDURES_PART2: List[Dict[str, Any]] = [
    # ────────── ENDOUROLOGY (cont.) ──────────
    {
        "key": "holep",
        "category": "Endourology",
        "anesthesia": "spinal",
        "name": _t(
            "Holmium Laser Enucleation of the Prostate (HoLEP)",
            "होलमियम लेज़र एनुक्लिएशन ऑफ़ प्रोस्टेट (HoLEP)",
            "હોલમિયમ લેઝર એન્યુક્લિએશન ઑફ પ્રોસ્ટેટ (HoLEP)",
        ),
        "procedure": _t(
            "Endoscopic enucleation of obstructing prostate tissue using a holmium laser. Size-independent, low blood loss. Catheter for 1-2 days.",
            "होलमियम लेज़र से अवरोधक प्रोस्टेट ऊतक का एंडोस्कोपिक एनुक्लिएशन। आकार-स्वतंत्र, कम रक्तस्राव। 1-2 दिनों तक कैथेटर।",
            "હોલમિયમ લેઝરથી અવરોધક પ્રોસ્ટેટ પેશીનું એન્ડોસ્કોપિક એન્યુક્લિએશન. માપ-સ્વતંત્ર, ઓછું રક્તસ્રાવ. 1-2 દિવસ માટે કેથેટર.",
        ),
        "specific_risks": [
            _t("Retrograde ejaculation (~75%).", "रिट्रोग्रेड स्खलन (~75%)।", "રિટ્રોગ્રેડ સ્ખલન (~75%)."),
            _t("Transient stress incontinence — usually resolves in weeks.", "अल्पकालिक तनाव असंयम — आमतौर पर हफ्तों में ठीक हो जाता है।", "ટૂંકા સમય માટે સ્ટ્રેસ અસંયમ — સામાન્ય રીતે અઠવાડિયામાં ઠીક થઈ જાય છે."),
            _t("Urethral stricture (2-5%).", "मूत्रमार्ग संकुचन (2-5%)।", "મૂત્રમાર્ગ સંકોચન (2-5%)."),
            _t("Capsular perforation (rare).", "कैप्सुलर वेधन (दुर्लभ)।", "કેપ્સ્યુલર છિદ્ર (દુર્લભ)."),
        ],
        "alternatives": _t(
            "TURP, GreenLight PVP, open simple prostatectomy, prostatic artery embolisation, medical therapy.",
            "TURP, ग्रीनलाइट PVP, ओपन सिंपल प्रोस्टेटेक्टॉमी, प्रोस्टेट धमनी एम्बोलाइज़ेशन, औषधीय उपचार।",
            "TURP, ગ્રીનલાઇટ PVP, ઓપન સિમ્પલ પ્રોસ્ટેટેક્ટોમી, પ્રોસ્ટેટ ધમની એમ્બોલાઇઝેશન, ઔષધ સારવાર.",
        ),
    },
    {
        "key": "pvp_greenlight",
        "category": "Endourology",
        "anesthesia": "spinal",
        "name": _t(
            "Photoselective Vaporisation of Prostate (PVP / GreenLight)",
            "प्रोस्टेट का फोटोसेलेक्टिव वेपोराइज़ेशन (PVP / ग्रीनलाइट)",
            "પ્રોસ્ટેટનું ફોટોસિલેક્ટિવ વેપોરાઇઝેશન (PVP / ગ્રીનલાઇટ)",
        ),
        "procedure": _t(
            "GreenLight laser vaporises obstructing prostate tissue with minimal bleeding. Day-care possible, catheter usually < 24 hrs.",
            "ग्रीनलाइट लेज़र अवरोधक प्रोस्टेट ऊतक को वेपराइज़ करता है, जिससे न्यूनतम रक्तस्राव होता है। डे-केयर संभव है, कैथेटर आमतौर पर 24 hrs से कम समय के लिए रहता है।",
            "ગ્રીનલાઇટ લેઝર અવરોધક પ્રોસ્ટેટ પેશીને વેપોરાઇઝ કરે છે, જેનાથી ન્યૂનતમ રક્તસ્રાવ થાય છે. ડે-કેર શક્ય છે, કેથેટર સામાન્ય રીતે 24 hrs થી ઓછા સમય માટે રહે છે.",
        ),
        "specific_risks": [
            _t("Retrograde ejaculation common.", "रिट्रोग्रेड स्खलन सामान्य।", "રિટ્રગ્રેડ સ્ખલન સામાન્ય."),
            _t("Dysuria for 1-2 weeks (irritative symptoms).", "1-2 सप्ताह तक डिसयूरिया (जलन वाले लक्षण) रह सकता है।", "1-2 અઠવાડિયા સુધી ડિસ્યુરિયા (બળતરા જેવા લક્ષણો) રહી શકે છે."),
            _t("Urethral stricture.", "मूत्रमार्ग संकुचन।", "મૂત્રમાર્ગ સંકોચન."),
        ],
        "alternatives": _t(
            "TURP, HoLEP, medical therapy, prostatic artery embolisation.",
            "TURP, HoLEP, औषधीय उपचार, प्रोस्टेट धमनी एम्बोलाइज़ेशन।",
            "TURP, HoLEP, ઔષધ સારવાર, પ્રોસ્ટેટ ધમની એમ્બોલાઇઝેશન.",
        ),
    },
    {
        "key": "cystolitholapaxy",
        "category": "Endourology",
        "anesthesia": "spinal",
        "name": _t(
            "Cystolitholapaxy (Bladder Stone Endoscopic Removal)",
            "सिस्टोलिथोलैपैक्सी (मूत्राशय पथरी एंडोस्कोपिक निष्कासन)",
            "સિસ્ટોલિથોલેપેક્સી (મૂત્રાશય પથરી એન્ડોસ્કોપિક નિષ્કાસન)",
        ),
        "procedure": _t(
            "Endoscopic fragmentation and removal of bladder stones via the urethra using laser or pneumatic lithotripsy.",
            "मूत्रमार्ग के माध्यम से लेज़र/न्यूमेटिक लिथोट्रिप्सी से मूत्राशय पथरी का एंडोस्कोपिक विखंडन एवं निष्कासन।",
            "મૂત્રમાર્ગ દ્વારા લેઝર/ન્યુમેટિક લિથોટ્રિપ્સીથી મૂત્રાશય પથરીનું એન્ડોસ્કોપિક તોડણ અને દૂર કરવું.",
        ),
        "specific_risks": [
            _t("Bladder mucosal injury / perforation (rare).", "मूत्राशय की अंदरूनी परत में चोट / छेद (दुर्लभ)।", "મૂત્રાશય મ્યુકોસામાં ઈજા / પરફોરેશન (દુર્લભ)."),
            _t("Retained fragments — may need 2nd procedure.", "बचे टुकड़े — 2nd प्रक्रिया की ज़रूरत पड़ सकती है।", "બાકી રહેલા ટુકડા — 2જી પ્રક્રિયાની જરૂર પડી શકે છે."),
            _t("Catheterisation 1-2 days.", "1-2 दिन तक कैथेटर लगा रहेगा।", "1-2 દિવસ સુધી કેથેટર રાખવામાં આવશે."),
        ],
        "alternatives": _t(
            "Open cystolithotomy, ESWL, percutaneous cystolithotomy.",
            "खुली सिस्टोलिथोटोमी, ESWL, पर्क्यूटेनियस सिस्टोलिथोटोमी।",
            "ખુલ્લી સિસ્ટોલિથોટોમી, ESWL, પર્ક્યુટેનિયસ સિસ્ટોલિથોટોમી.",
        ),
    },
    {
        "key": "urethral_dilatation",
        "category": "Minor Procedure",
        "anesthesia": "la",
        "name": _t(
            "Urethral Dilatation",
            "मूत्रमार्ग फैलाव",
            "મૂત્રમાર્ગ ફેલાવણી",
        ),
        "procedure": _t(
            "Gradual mechanical widening of a narrowed urethra using progressively larger dilators or balloon under local/topical anaesthesia.",
            "स्थानीय/टॉपिकल एनेस्थीसिया में बढ़ते आकार के डायलेटर या बैलून से सिकुड़े मूत्रमार्ग का क्रमिक यांत्रिक विस्तार।",
            "સ્થાનિક/ટોપિકલ એનેસ્થેસિયા હેઠળ ક્રમશઃ મોટા ડાયલેટર અથવા બલૂન વડે સંકુચિત મૂત્રમાર્ગનું તબક્કાવાર યાંત્રિક ફેલાવણ.",
        ),
        "specific_risks": [
            _t("Bleeding, bruising of urethra.", "रक्तस्राव, मूत्रमार्ग में चोट।", "રક્તસ્રાવ, મૂત્રમાર્ગમાં ઈજા."),
            _t("Urethral injury / false passage.", "यूरेथ्रा की चोट / false passage।", "યુરેથ્રા ની ઈજા / false passage."),
            _t("High recurrence — most patients need repeats.", "उच्च पुनरावृत्ति — अधिकांश मरीज़ों को इसे बार-बार करवाना पड़ सकता है।", "ઊંચી પુનરાવૃત્તિ — મોટાભાગના દર્દીઓને વારંવાર પ્રક્રિયા કરાવવાની જરૂર પડી શકે છે."),
        ],
        "alternatives": _t(
            "DVIU (more durable), urethroplasty (best long-term), CIC.",
            "DVIU (अधिक टिकाऊ), यूरेथ्रोप्लास्टी (सर्वोत्तम दीर्घकालिक), CIC।",
            "DVIU (વધુ ટકાઉ), યુરેથ્રોપ્લાસ્ટી (શ્રેષ્ઠ લાંબા ગાળાની), CIC.",
        ),
    },
    {
        "key": "pcn",
        "category": "Minor Procedure",
        "anesthesia": "la",
        "name": _t(
            "Percutaneous Nephrostomy (PCN)",
            "पर्क्यूटेनियस नेफ्रोस्टॉमी (PCN)",
            "પર્ક્યુટેનિયસ નેફ્રોસ્ટોમી (PCN)",
        ),
        "procedure": _t(
            "Image-guided placement of a tube from the back into the kidney to drain urine when normal drainage is obstructed.",
            "जब मूत्र की सामान्य निकासी अवरुद्ध हो जाती है, तो उसे निकालने के लिए इमेज-गाइडेड तरीके से पीठ से किडनी में एक ट्यूब डाली जाती है।",
            "જ્યારે મૂત્રનો સામાન્ય નિકાલ અવરોધાય છે, ત્યારે તેને બહાર કાઢવા માટે ઇમેજ-ગાઇડેડ પદ્ધતિથી પીઠમાંથી કિડનીમાં એક ટ્યુબ મૂકવામાં આવે છે.",
        ),
        "specific_risks": [
            _t("Bleeding (1-3%) — may need transfusion / embolisation.", "रक्तस्राव (1-3%) — ब्लड ट्रांसफ्यूजन या एम्बोलाइज़ेशन करना पड़ सकता है।", "રક્તસ્રાવ (1-3%) — બ્લડ ટ્રાન્સફ્યુઝન અથવા એમ્બોલાઇઝેશન કરવું પડી શકે છે."),
            _t("Tube blockage / displacement — needs replacement.", "ट्यूब अवरोध / विस्थापन — प्रतिस्थापन आवश्यक।", "ટ્યુબ અવરોધ / સ્થાનભ્રંશ — ફેરબદલ જરૂરી."),
            _t("Pleural injury for high punctures (rare).", "उच्च पंचर के कारण प्ल्यूरल इंजरी (दुर्लभ)।", "ઊંચા છિદ્ર માટે પ્લ્યુરા ઈજા (દુર્લભ)."),
            _t("Urinary leak / urinoma.", "मूत्र रिसाव / यूरीनोमा।", "મૂત્ર લીકેજ / યુરિનોમા."),
        ],
        "alternatives": _t(
            "Retrograde DJ stenting via cystoscopy, expectant management for partial obstruction.",
            "सिस्टोस्कोपी द्वारा रेट्रोग्रेड DJ स्टेंटिंग, आंशिक अवरोध के लिए अपेक्षित प्रबंधन।",
            "સિસ્ટોસ્કોપી દ્વારા રેટ્રોગ્રેડ DJ સ્ટેન્ટિંગ, આંશિક અવરોધ માટે અપેક્ષિત વ્યવસ્થાપન.",
        ),
    },
    {
        "key": "dj_removal",
        "category": "Minor Procedure",
        "anesthesia": "la",
        "name": _t(
            "DJ Stent Removal",
            "DJ स्टेंट निष्कासन",
            "DJ સ્ટેન્ટ દૂર કરવું",
        ),
        "procedure": _t(
            "Cystoscopic removal of an indwelling DJ stent under local / topical anaesthesia. Day-care procedure, ~10 minutes.",
            "स्थानीय/टॉपिकल एनेस्थीसिया में सिस्टोस्कोपी द्वारा DJ स्टेंट को निकालना। डे-केयर, ~10 मिनट।",
            "સ્થાનિક/ટોપિકલ એનેસ્થેસિયા હેઠળ સિસ્ટોસ્કોપીથી DJ સ્ટેન્ટ દૂર કરવું. ડે-કેર પ્રક્રિયા, ~10 મિનિટ.",
        ),
        "specific_risks": [
            _t("Mild burning, transient haematuria.", "हल्की जलन, कुछ समय के लिए रक्तमूत्र।", "હળવી બળતરા, થોડા સમય માટે રક્તમૂત્ર."),
            _t("Urinary tract infection.", "मूत्र मार्ग संक्रमण।", "મૂત્રમાર્ગ ચેપ."),
            _t("Stent fragmentation if encrusted (rare) — may need URS.", "एनक्रस्टेड होने पर स्टेंट के टुकड़े हो सकते हैं (दुर्लभ) — URS की आवश्यकता हो सकती है।", "જો સ્ટેન્ટ એન્ક્રસ્ટેડ થાય, તો તેના ટુકડા થઈ શકે છે (દુર્લભ) — URS ની જરૂર પડી શકે છે."),
        ],
        "alternatives": _t(
            "None — retained DJ must be removed; rarely a magnetic stent is used.",
            "कोई नहीं — रखे गए DJ को हटाना अनिवार्य है; दुर्लभ रूप से चुंबकीय स्टेंट का उपयोग किया जाता है।",
            "કોઈ નહીં — મૂકેલા DJ ને દૂર કરવો જ પડે; ભાગ્યે જ ચુંબકીય સ્ટેન્ટનો ઉપયોગ થાય છે.",
        ),
    },
    # ────────── OPEN / RECONSTRUCTIVE ──────────
    {
        "key": "open_simple_prostatectomy",
        "category": "Open Surgery",
        "anesthesia": "ga",
        "name": _t(
            "Open Simple Prostatectomy",
            "ओपन सिंपल प्रोस्टेटेक्टॉमी",
            "ઓપન સિમ્પલ પ્રોસ્ટેટેક્ટોમી",
        ),
        "procedure": _t(
            "Open surgical removal of obstructing benign prostate tissue through a lower abdominal incision (Millin / Freyer technique). Reserved for very large prostates (>80-100 g).",
            "निचले पेट पर चीरा लगाकर (Millin / Freyer तकनीक से) रुकावट पैदा करने वाले सौम्य प्रोस्टेट के tissue को ओपन सर्जरी से निकाला जाता है। यह प्रक्रिया बहुत बड़े प्रोस्टेट (>80-100 ग्राम) के लिए की जाती है।",
            "નીચલા પેટ પર ચીરો મૂકીને (Millin / Freyer ટેકનિકથી) અવરોધ પેદા કરતા સૌમ્ય પ્રોસ્ટેટના tissueને ઓપન સર્જરીથી દૂર કરવામાં આવે છે. આ પ્રક્રિયા ખૂબ મોટા પ્રોસ્ટેટ (>80-100 ગ્રામ) માટે હોય છે.",
        ),
        "specific_risks": [
            _t("Significant blood loss — transfusion may be needed.", "खून ज़्यादा बह सकता है — ट्रांसफ्यूजन की ज़रूरत पड़ सकती है।", "વધારે લોહી વહી શકે છે — ટ્રાન્સફ્યુઝનની જરૂર પડી શકે છે."),
            _t("Retrograde ejaculation, incontinence, ED — similar to TURP.", "रिट्रोग्रेड स्खलन, असंयम, ED — TURP के समान।", "રિટ્રોગ્રેડ સ્ખલન, અસંયમ, ED — TURP જેવી."),
            _t("Wound infection, longer recovery (~4 weeks).", "घाव संक्रमण, लंबी रिकवरी (~4 सप्ताह)।", "ઘા ચેપ, લાંબી રિકવરી (~4 અઠવાડિયા)."),
            _t("Catheter for 5-7 days.", "5-7 दिन कैथेटर।", "5-7 દિવસ કેથેટર."),
        ],
        "alternatives": _t(
            "TURP for smaller glands, HoLEP, GreenLight PVP, embolisation, medical therapy.",
            "छोटे ग्रंथियों हेतु TURP, HoLEP, ग्रीनलाइट PVP, एम्बोलाइज़ेशन, औषधीय उपचार।",
            "નાની ગ્રંથિઓ માટે TURP, HoLEP, ગ્રીનલાઇટ PVP, એમ્બોલાઇઝેશન, ઔષધ સારવાર.",
        ),
    },
    {
        "key": "radical_prostatectomy",
        "category": "Oncology",
        "anesthesia": "ga",
        "name": _t(
            "Radical Prostatectomy",
            "रेडिकल प्रोस्टेटेक्टॉमी",
            "રેડિકલ પ્રોસ્ટેટેક્ટોમી",
        ),
        "procedure": _t(
            "Surgical removal of the prostate gland and seminal vesicles for prostate cancer. Performed open, laparoscopically, or robotically. Pelvic lymph node dissection may be added.",
            "प्रोस्टेट कैंसर के लिए प्रोस्टेट ग्लैंड और सेमिनल वेसिकल्स का सर्जिकल निष्कासन। यह सर्जरी ओपन, लैप्रोस्कोपिक या रोबोटिक तरीके से की जाती है। इसमें पेल्विक लिम्फ नोड डाइसेक्शन भी जोड़ा जा सकता है।",
            "પ્રોસ્ટેટ કેન્સર માટે પ્રોસ્ટેટ ગ્લેન્ડ અને સેમિનલ વેસિકલ્સને સર્જરી કરીને દૂર કરવામાં આવે છે. આ સર્જરી ઓપન, લેપ્રોસ્કોપિક કે રોબોટિક રીતે કરવામાં આવે છે. પેલ્વિક લિમ્ફ નોડ ડાયસેક્શન પણ ઉમેરી શકાય છે.",
        ),
        "specific_risks": [
            _t("Erectile dysfunction (50-70%) — nerve-sparing reduces risk.", "इरेक्टाइल डिसफंक्शन (50-70%) — नर्व-स्पेयरिंग जोखिम कम करता है।", "ઇરેક્ટાઇલ ડિસફંક્શન (50-70%) — નર્વ-સ્પેરિંગ જોખમ ઘટાડે."),
            _t("Urinary incontinence (5-15%) — usually improves over months.", "मूत्र असंयम (5-15%) — आमतौर पर महीनों में सुधार आता है।", "મૂત્ર અસંયમ (5-15%) — સામાન્ય રીતે મહિનાઓમાં સુધારો થાય છે."),
            _t("Bladder neck contracture, anastomotic leak.", "ब्लैडर नेक कॉन्ट्रैक्चर, एनास्टोमोटिक लीक।", "મૂત્રાશય ગરદન સંકોચન, જોડાણમાંથી લીકેજ."),
            _t("Positive surgical margins → may need radiation / hormone therapy.", "पॉजिटिव सर्जिकल मार्जिन → रेडिएशन / हार्मोन थेरेपी की आवश्यकता पड़ सकती है।", "પોઝિટિવ સર્જિકલ માર્જિન → રેડિએશન / હોર્મોન થેરાપીની જરૂર પડી શકે છે."),
            _t("DVT/PE, lymphocele, rectal injury (rare).", "DVT/PE, लिम्फोसील, मलाशय चोट (दुर्लभ)।", "DVT/PE, લિમ્ફોસીલ, મલાશય ઈજા (દુર્લભ)."),
        ],
        "alternatives": _t(
            "Active surveillance (low-risk), external beam radiotherapy, brachytherapy, hormonal therapy, focal therapy.",
            "सक्रिय निगरानी (निम्न-जोखिम), एक्सटर्नल बीम रेडियोथेरेपी, ब्रेकीथेरेपी, हार्मोनल थेरेपी, फोकल थेरेपी।",
            "સક્રિય નિરીક્ષણ (નિમ્ન-જોખમ), એક્સટર્નલ બીમ રેડિઓથેરાપી, બ્રેકીથેરાપી, હોર્મોનલ થેરાપી, ફોકલ થેરાપી.",
        ),
    },
    {
        "key": "radical_cystectomy",
        "category": "Oncology",
        "anesthesia": "ga",
        "name": _t(
            "Radical Cystectomy with Urinary Diversion",
            "रेडिकल सिस्टेक्टॉमी और यूरिनरी डायवर्जन",
            "રેડિકલ સિસ્ટેક્ટોમી અને યૂરિનરી ડાયવર્ઝન",
        ),
        "procedure": _t(
            "Removal of bladder, prostate (men) or uterus/ovaries (women), with creation of urinary diversion (ileal conduit / neobladder / ureterocutaneostomy). Major surgery.",
            "मूत्राशय, प्रोस्टेट (पुरुष) या गर्भाशय/अंडाशय (महिला) को हटाना और यूरिनरी डायवर्जन (आइलियल कंड्यूट / नियोब्लैडर / यूरेटरोक्यूटेनियोस्टॉमी) का निर्माण करना। यह एक बड़ी सर्जरी है।",
            "મૂત્રાશય, પ્રોસ્ટેટ (પુરૂષ) અથવા ગર્ભાશય/અંડાશય (સ્ત્રી)નું દૂર કરવું અને યુરિનરી ડાયવર્ઝન (ઇલિયલ કંડ્યુટ / નિયોબ્લેડર / યુરેટરોક્યુટેનિયોસ્ટોમી) બનાવવું. આ એક મોટી સર્જરી છે.",
        ),
        "specific_risks": [
            _t("Major surgery — 1-3% mortality, ICU stay common.", "बड़ी सर्जरी — 1-3% मृत्यु दर, ICU भर्ती सामान्य।", "મોટી સર્જરી — 1-3% મૃત્યુદર, ICU રોકાણ સામાન્ય."),
            _t("Bowel anastomotic leak, ileus, fistula.", "आंत एनास्टोमोटीक लीक, इलियस, फिस्टुला।", "આંતરડાનો એનાસ્ટોમોટિક લીક, ઇલિયસ, ફિસ્ટુલા"),
            _t("Erectile dysfunction in men, sexual dysfunction in women.", "पुरुष में स्तंभन दोष, महिलाओं में यौन दुष्क्रिया।", "પુરૂષમાં ઇરેક્ટાઇલ ડિસફંક્શન, સ્ત્રીમાં લૈંગિક ડિસફંક્શન."),
            _t("Stoma complications (parastomal hernia, retraction).", "स्टोमा जटिलताएं (पैरास्टोमल हर्निया, पीछे हटना)।", "સ્ટોમા જટિલતાઓ (પેરાસ્ટોમલ હર્નિયા, પાછળ હટવું)."),
            _t("Lifelong B12, electrolyte and renal monitoring.", "आजीवन B12, इलेक्ट्रोलाइट और किडनी की निगरानी।", "આજીવન B12, ઇલેક્ટ્રોલાઇટ અને કિડની નિરીક્ષણ."),
        ],
        "alternatives": _t(
            "Trimodal therapy (TURBT + chemoradiation), partial cystectomy, palliative care.",
            "ट्राइमोडल थेरेपी (TURBT + केमोरेडिएशन), आंशिक सिस्टेक्टोमी, उपशामक देखभाल।",
            "ટ્રાઇમોડલ થેરાપી (TURBT + કેમોરેડિએશન), આંશિક સિસ્ટેક્ટોમી, ઉપશામક સંભાળ.",
        ),
    },
    {
        "key": "radical_nephrectomy",
        "category": "Oncology",
        "anesthesia": "ga",
        "name": _t(
            "Radical Nephrectomy",
            "रेडिकल नेफ्रेक्टॉमी",
            "રેડિકલ નેફ્રેક્ટોમી",
        ),
        "procedure": _t(
            "Removal of the kidney along with surrounding fat (Gerota's fascia), adrenal gland (when indicated), and regional lymph nodes for renal cancer. Open or laparoscopic.",
            "गुर्दे के कैंसर हेतु गुर्दा, आसपास की चर्बी (गेरोटा फेशिया), एड्रेनल ग्लैंड (संकेत होने पर) एवं क्षेत्रीय लसिका ग्रंथियों का निष्कासन। ओपन या लैप्रोस्कोपिक।",
            "કિડની કેન્સર માટે કિડની, આસપાસની ચરબી (ગેરોટા ફેશિયા), એડ્રિનલ ગ્લેન્ડ (સંકેત હોય તો) અને પ્રાદેશિક લિમ્ફ નોડ્સ કાઢી નાખવા. ઓપન અથવા લેપ્રોસ્કોપિક.",
        ),
        "specific_risks": [
            _t("Single-kidney living — renal function monitoring needed.", "एक किडनी के साथ जीने के लिए किडनी फंक्शन की निगरानी ज़रूरी है।", "એક કિડની સાથે જીવવા માટે કિડની ફંક્શનનું નિરીક્ષણ જરૂરી છે."),
            _t("Bleeding from renal vessels — may need transfusion.", "रीनल वेसल्स से रक्तस्राव — ट्रांसफ्यूजन की ज़रूरत पड़ सकती है।", "રીનલ વેસલ્સથી રક્તસ્રાવ — ટ્રાન્સફ્યુઝનની જરૂર પડી શકે છે."),
            _t("Injury to bowel, spleen, pancreas, pleura.", "आंत, प्लीहा, अग्न्याशय, प्ल्यूरा को चोट।", "આંતરડા, બરોળ, સ્વાદુપિંડ, પ્લ્યુરા ને ઈજા."),
            _t("Recurrence — depends on stage; surveillance imaging needed.", "पुनरावृत्ति — चरण पर निर्भर; निगरानी इमेजिंग आवश्यक।", "પુનરાવૃત્તિ — સ્ટેજ પર આધાર; નિરીક્ષણ ઇમેજિંગ જરૂરી."),
        ],
        "alternatives": _t(
            "Partial nephrectomy, ablation (RFA / cryo), active surveillance for very small tumours.",
            "आंशिक नेफ्रेक्टॉमी, अबलेशन (RFA / क्रायो), बहुत छोटे ट्यूमर हेतु सक्रिय निगरानी।",
            "આંશિક નેફ્રેક્ટોમી, એબ્લેશન (RFA / ક્રાયો), ખૂબ નાના ટ્યુમર માટે સક્રિય નિરીક્ષણ.",
        ),
    },
    {
        "key": "partial_nephrectomy",
        "category": "Oncology",
        "anesthesia": "ga",
        "name": _t(
            "Partial Nephrectomy (Nephron-Sparing Surgery)",
            "आंशिक नेफ्रेक्टॉमी (नेफ्रॉन-स्पेयरिंग सर्जरी)",
            "આંશિક નેફ્રેક્ટોમી (નેફ્રોન-સ્પેરિંગ સર્જરી)",
        ),
        "procedure": _t(
            "Removal of the tumour with a margin of normal kidney, preserving the rest of the kidney. Open / laparoscopic / robotic. Renal artery clamping may be needed.",
            "ट्यूमर को सामान्य गुर्दे के एक margin के साथ हटाना, और बाकी गुर्दे को बचाना। ओपन / लैप्रोस्कोपिक / रोबोटिक। गुर्दे की धमनी क्लैम्पिंग आवश्यक हो सकती है।",
            "ગાંઠને સામાન્ય કિડનીના એક margin સાથે દૂર કરવી, અને બાકીની કિડનીને બચાવવી. ઓપન / લેપ્રોસ્કોપિક / રોબોટિક. કિડની ધમની ક્લેમ્પિંગ જરૂરી પડી શકે.",
        ),
        "specific_risks": [
            _t("Bleeding from cut kidney surface — transfusion may be needed.", "कटी हुई किडनी सतह से रक्तस्राव — ट्रांसफ्यूजन की ज़रूरत पड़ सकती है।", "કાપેલી કિડની સપાટીથી રક્તસ્રાવ — ટ્રાન્સફ્યુઝનની જરૂર પડી શકે છે."),
            _t("Urinary leak — may need DJ stent or repeat surgery.", "मूत्र रिसाव — DJ स्टेंट या दोबारा सर्जरी की ज़रूरत पड़ सकती है।", "મૂત્ર લીકેજ — DJ સ્ટેન્ટ અથવા ફરીથી સર્જરીની જરૂર પડી શકે છે."),
            _t("Positive margins / need for completion radical nephrectomy.", "सकारात्मक मार्जिन / दोबारा रेडिकल नेफ्रेक्टॉमी की ज़रूरत", "પોઝિટિવ માર્જિન / ફરીથી રેડિકલ નેફ્રેક્ટોમી કરવાની જરૂરિયાત"),
            _t("Conversion to radical / open surgery (5-10%).", "रेडिकल / ओपन सर्जरी में रूपांतरण (5-10%)।", "રેડિકલ / ઓપન સર્જરીમાં રૂપાંતર (5-10%)."),
        ],
        "alternatives": _t(
            "Radical nephrectomy, ablation, active surveillance for small renal masses.",
            "रेडिकल नेफ्रेक्टॉमी, अबलेशन, छोटे किडनी मासेस के लिए सक्रिय निगरानी।",
            "રેડિકલ નેફ્રેક્ટોમી, એબ્લેશન, નાના કિડની માસ માટે સક્રિય નિરીક્ષણ.",
        ),
    },
    {
        "key": "nephroureterectomy",
        "category": "Oncology",
        "anesthesia": "ga",
        "name": _t(
            "Nephroureterectomy",
            "नेफ्रोयूरेटरेक्टॉमी",
            "નેફ્રોયુરેટરેક્ટોમી",
        ),
        "procedure": _t(
            "Complete removal of kidney and entire ureter with bladder cuff for upper-tract urothelial cancer. Open or laparoscopic.",
            "ऊपरी पथ यूरोथेलियल कैंसर के लिए किडनी और पूरे यूरेटर का ब्लैडर कफ समेत पूरा निष्कासन। ओपन या लैप्रोस्कोपिक।",
            "ઉપરી પથ યુરોથેલિયલ કેન્સર માટે કિડની અને સંપૂર્ણ યુરેટરનું બ્લેડર કફ સહિત સંપૂર્ણપણે દૂર કરવું. ઓપન અથવા લેપ્રોસ્કોપિક.",
        ),
        "specific_risks": [
            _t("Bladder recurrence (~30%) — surveillance cystoscopy needed.", "मूत्राशय पुनरावृत्ति (~30%) — निगरानी सिस्टोस्कोपी आवश्यक।", "મૂત્રાશય પુનરાવૃત્તિ (~30%) — નિરીક્ષણ સિસ્ટોસ્કોપી જરૂરી."),
            _t("Bleeding, bowel injury, pleural injury.", "रक्तस्राव, आंत चोट, प्‍ल्यूरा चोट।", "રક્તસ્રાવ, આંતરડું ઈજા, પ્લ્યુરા ઈજા."),
            _t("Loss of one kidney → renal monitoring.", "एक किडनी का नुकसान → रेनल मॉनिटरिंग।", "એક કિડની ગુમાવવી → રેનલ મોનિટરિંગ."),
        ],
        "alternatives": _t(
            "Endoscopic management for low-grade tumours, palliative care.",
            "निम्न-श्रेणी ट्यूमर हेतु एंडोस्कोपिक प्रबंधन, उपशामक देखभाल।",
            "નિમ્ન-ગ્રેડ ટ્યુમરો માટે એન્ડોસ્કોપિક વ્યવસ્થાપન, ઉપશામક સંભાળ.",
        ),
    },
    {
        "key": "adrenalectomy",
        "category": "Open Surgery",
        "anesthesia": "ga",
        "name": _t(
            "Adrenalectomy",
            "एड्रेनलेक्टॉमी",
            "એડ્રિનલેક્ટોમી",
        ),
        "procedure": _t(
            "Surgical removal of one or both adrenal glands for hormone-secreting tumours, adrenal cancer, or pheochromocytoma. Laparoscopic preferred.",
            "हार्मोन बनाने वाले ट्यूमर, एड्रिनल कैंसर या फियोक्रोमोसाइटोमा के लिए एक या दोनों एड्रिनल ग्रंथियों को सर्जरी से निकाला जाता है। लैप्रोस्कोपिक विधि को प्राथमिकता दी जाती है।",
            "હોર્મોન-સ્રાવી ગાંઠો, એડ્રિનલ કેન્સર અથવા ફિયોક્રોમોસાયટોમા માટે એક/બંને એડ્રિનલ ગ્રંથિઓને સર્જરી દ્વારા દૂર કરવી. લેપ્રોસ્કોપિક પસંદ.",
        ),
        "specific_risks": [
            _t("Hypertensive crisis intraop (pheochromocytoma) — needs alpha-blockade pre-op.", "हाइपरटेंसिव क्राइसिस इंट्राऑप (फियोक्रोमोसाइटोमा) — पूर्व-ऑप अल्फा-ब्लॉकेड आवश्यक।", "હાઈપરટેન્સિવ ક્રાઇસિસ ઇન્ટ્રાઑપ (ફિયોક્રોમોસાયટોમા) — ઑપરેશન પૂર્વે આલ્ફા-બ્લોકેડ જરૂરી."),
            _t("Adrenal insufficiency post bilateral surgery — lifelong steroids.", "bilateral सर्जरी के बाद एड्रिनल इंसफिशिएंसी — आजीवन स्टेरॉयड।", "bilateral સર્જરી બાદ એડ્રિનલ ઇન્સફિશિયન્સી — આજીવન સ્ટેરોઇડ્સ."),
            _t("Bleeding, organ injury (liver / spleen / pancreas).", "रक्तस्राव, अंग चोट (यकृत/प्लीहा/अग्न्याशय)।", "રક્તસ્રાવ, અંગ ઈજા (યકૃત/બરોળ/સ્વાદુપિંડ)."),
        ],
        "alternatives": _t(
            "Medical management of hormonal excess, observation for non-functioning incidentalomas <4 cm.",
            "हार्मोनल अति का चिकित्सीय प्रबंधन, गैर-कार्यात्मक incidentaloma <4 सेमी की निगरानी।",
            "હોર્મોનલ વધારાનું તબીબી વ્યવસ્થાપન, બિન-કાર્યક્ષમ ઇન્સિડેન્ટલોમા <4 સેમીનું નિરીક્ષણ.",
        ),
    },
    {
        "key": "pyeloplasty",
        "category": "Reconstruction",
        "anesthesia": "ga",
        "name": _t(
            "Anderson-Hynes Pyeloplasty",
            "एंडरसन-हाइन्स पाइलोप्लास्टी",
            "એન્ડરસન-હાઇન્સ પાયલોપ્લાસ્ટી",
        ),
        "procedure": _t(
            "Reconstruction of an obstructed pelvi-ureteric junction (PUJ) by excising the narrow segment and re-anastomosing the ureter to the renal pelvis. Open / laparoscopic / robotic.",
            "अवरुद्ध पेल्वि-यूरेटरिक जंक्शन (PUJ) के संकीर्ण भाग को निकालकर ureter को रीनल पेल्विस से पुनः जोड़कर पुनर्निर्माण। ओपन/लेप्रोस्कोपिक/रोबोटिक।",
            "અવરોધિત પેલ્વિ-યુરેટરિક જંકશન (PUJ) ના સાંકડા ભાગને દૂર કરી ureter ને કિડની પેલ્વિસ સાથે ફરી જોડીને પુનર્નિર્માણ. Open / laparoscopic / robotic.",
        ),
        "specific_risks": [
            _t("Anastomotic leak — DJ stent for 4-6 weeks.", "एनास्टोमोटिक लीक — 4-6 सप्ताह DJ स्टेंट।", "એનાસ્ટોમોટિક લીકેજ — 4-6 અઠવાડિયા DJ સ્ટેન્ટ."),
            _t("Recurrent obstruction (5-10%).", "पुनरावर्ती अवरोध (5-10%)।", "પુનરાવર્તિત અવરોધ (5-10%)."),
            _t("Need for re-do surgery.", "पुनः सर्जरी की आवश्यकता।", "પુનઃ સર્જરીની જરૂર."),
        ],
        "alternatives": _t(
            "Endopyelotomy, observation if minimal obstruction with preserved function.",
            "एंडोपाइलोटोमी, यदि कार्यक्षमता बनी रहे और न्यूनतम अवरोध हो तो अवलोकन।",
            "એન્ડોપાયલોટોમી, જો કાર્યક્ષમતા જળવાઈ રહે અને ન્યૂનતમ અવરોધ હોય તો અવલોકન.",
        ),
    },
    {
        "key": "ureteric_reimplantation",
        "category": "Reconstruction",
        "anesthesia": "ga",
        "name": _t(
            "Ureteric Reimplantation",
            "यूरेटरिक रिइम्प्लांटेशन",
            "યુરેટરિક રિઇમ્પ્લાન્ટેશન",
        ),
        "procedure": _t(
            "Surgical reattachment of the ureter to the bladder for VUR, distal stricture, or trauma. Various techniques (Lich-Gregoir, Cohen, psoas hitch).",
            "VUR, डिस्टल संकुचन या आघात हेतु यूरेटर को मूत्राशय से पुनः जोड़ना। विभिन्न तकनीकें (लिच-ग्रेग्वार, कोहेन, सोआस हिच)।",
            "VUR, ડિસ્ટલ સંકોચન અથવા ઈજા માટે યુરેટરને મૂત્રાશય સાથે ફરી જોડવું. વિવિધ તકનીકો (લિચ-ગ્રેગ્વાર, કોહેન, સોઆસ હિચ).",
        ),
        "specific_risks": [
            _t("Persistent reflux / recurrent obstruction.", "लगातार रिफ्लक्स / पुनरावर्ती अवरोध।", "ચાલુ રિફ્લક્સ / પુનરાવર્તિત અવરોધ."),
            _t("Bladder spasms post-op.", "पोस्ट-ऑप मूत्राशय ऐंठन।", "પોસ્ટ-ઓપ મૂત્રાશય આંચકી."),
            _t("DJ stent + catheter 1-2 weeks.", "1-2 सप्ताह DJ स्टेंट + कैथेटर।", "1-2 અઠવાડિયા DJ સ્ટેન્ટ + કેથેટર."),
        ],
        "alternatives": _t(
            "Endoscopic STING for VUR, antibiotic prophylaxis for low-grade VUR.",
            "VUR हेतु एंडोस्कोपिक STING, निम्न-श्रेणी VUR हेतु एंटीबायोटिक प्रोफिलैक्सिस।",
            "VUR માટે એન્ડોસ્કોપિક STING, નિમ્ન-ગ્રેડ VUR માટે એન્ટિબાયોટિક પ્રોફિલેક્સિસ.",
        ),
    },
    {
        "key": "ureterolithotomy",
        "category": "Open Surgery",
        "anesthesia": "ga",
        "name": _t(
            "Ureterolithotomy",
            "यूरेटरोलिथोटोमी",
            "યુરેટરોલિથોટોમી",
        ),
        "procedure": _t(
            "Open or laparoscopic surgical removal of an impacted ureteric stone through a flank or Gibson incision. Reserved for very large or impacted stones.",
            "फ्लैंक या गिब्सन चीरे के माध्यम से फंसी हुई यूरेटरिक पथरी को ओपन या लैप्रोस्कोपिक तरीके से निकालना। यह बहुत बड़ी या फंसी हुई पथरी के लिए ही की जाती है।",
            "ફ્લેન્ક અથવા ગિબ્સન કાપ દ્વારા ફસાયેલી યુરેટરિક પથરીને ઓપન અથવા લેપ્રોસ્કોપિક રીતે સર્જિકલ રીતે દૂર કરવી. આ પ્રક્રિયા ખૂબ મોટી અથવા ફસાયેલી પથરી માટે જ કરવામાં આવે છે.",
        ),
        "specific_risks": [
            _t("Urine leak — DJ stent + drain.", "मूत्र रिसाव — DJ स्टेंट + ड्रेन।", "મૂત્ર લીકેજ — DJ સ્ટેન્ટ + ડ્રેન."),
            _t("Ureteric stricture at incision site.", "चीरा स्थल पर यूरेटर संकुचन।", "કાપ સ્થળે યુરેટર સંકોચન."),
            _t("Wound infection, scar.", "घाव संक्रमण, निशान।", "ઘા ચેપ, ડાઘ."),
        ],
        "alternatives": _t(
            "URS with laser, ESWL, percutaneous antegrade ureteroscopy.",
            "लेज़र के साथ URS, ESWL, पर्क्यूटेनियस एंटीग्रेड यूरेटेरोस्कोपी।",
            "લેઝર સાથે URS, ESWL, પર્ક્યુટેનિયસ એન્ટિગ્રેડ યુરેટેરોસ્કોપી.",
        ),
    },
    {
        "key": "cystolithotomy",
        "category": "Open Surgery",
        "anesthesia": "spinal",
        "name": _t(
            "Open Cystolithotomy",
            "ओपन सिस्टोलिथोटोमी",
            "ઓપન સિસ્ટોલિથોટોમી",
        ),
        "procedure": _t(
            "Open removal of large bladder stones through a low abdominal (Pfannenstiel) incision. Reserved for stones too large or hard for endoscopic management.",
            "पेट के निचले हिस्से में Pfannenstiel incision लगाकर, मूत्राशय की बड़ी पथरी को ओपन तरीके से निकाला जाता है। यह उन पथरी के लिए होता है जो endoscopic management से निकालने के लिए बहुत बड़ी या कठोर होती हैं।",
            "પેટના નીચેના ભાગમાં Pfannenstiel incision મૂકીને, મૂત્રાશયની મોટી પથરીને ઓપન રીતે કાઢવામાં આવે છે. આ પદ્ધતિ એવી પથરી માટે છે જે endoscopic management થી કાઢવા માટે ખૂબ મોટી કે સખત હોય છે.",
        ),
        "specific_risks": [
            _t("Wound infection, scar.", "घाव संक्रमण, निशान।", "ઘા ચેપ, ડાઘ."),
            _t("Catheter for 5-7 days.", "5-7 दिन कैथेटर।", "5-7 દિવસ કેથેટર."),
            _t("Bladder fistula (rare).", "मूत्राशय फिस्टुला (दुर्लभ)।", "મૂત્રાશય ફિસ્ટુલા (દુર્લભ)."),
        ],
        "alternatives": _t(
            "Endoscopic cystolitholapaxy, percutaneous cystolithotomy.",
            "एंडोस्कोपिक सिस्टोलिथोलैपैक्सी, पर्क्यूटेनियस सिस्टोलिथोटोमी।",
            "એન્ડોસ્કોપિક સિસ્ટોલિથોલેપાક્સી, પર્ક્યુટેનિયસ સિસ્ટોલિથોટોમી.",
        ),
    },
    {
        "key": "buccal_urethroplasty",
        "category": "Reconstruction",
        "anesthesia": "ga",
        "name": _t(
            "Buccal Mucosa Urethroplasty",
            "बुक्कल म्यूकोसा यूरेथ्रोप्लास्टी",
            "બક્કલ મ્યુકોસા યુરેથ્રોપ્લાસ્ટી",
        ),
        "procedure": _t(
            "Reconstruction of long urethral strictures using a graft of inner-cheek (buccal) mucosa. Definitive treatment with high success rates (>80%).",
            "गाल के अंदर की (buccal) म्यूकोसा graft का इस्तेमाल करके लंबे urethral strictures का पुनर्निर्माण। यह एक definitive treatment है, जिसकी सफलता दर उच्च (>80%) है।",
            "ગાલની અંદરની (buccal) mucosa graft નો ઉપયોગ કરીને લાંબા urethral strictures નું પુનર્નિર્માણ. આ એક definitive treatment છે, જેનો સફળતા દર ઊંચો (>80%) છે.",
        ),
        "specific_risks": [
            _t("Recurrent stricture (10-20%).", "पुनरावर्ती संकुचन (10-20%)।", "પુનરાવર્તિત સંકોચન (10-20%)."),
            _t("Mouth numbness/contracture at donor site (usually transient).", "दाता स्थल पर मुख सुन्नता/संकुचन (आमतौर पर अल्पकालिक)।", "દાતા સ્થળે મુખ સુન્નતા/સંકોચન (સામાન્ય રીતે કામચલાઉ)."),
            _t("Erectile dysfunction (rare).", "स्तंभन दोष (दुर्लभ)।", "ઇરેક્ટાઇલ ડિસફંક્શન (દુર્લભ)."),
            _t("Catheter 2-3 weeks, no sexual activity 6 weeks.", "2-3 सप्ताह कैथेटर। 6 सप्ताह तक यौन संबंध न रखें।", "2-3 અઠવાડિયા કેથેટર. 6 અઠવાડિયા સુધી લૈંગિક સંબંધ ન રાખવા."),
        ],
        "alternatives": _t(
            "DVIU (less durable), urethral dilatation, perineal urethrostomy, lifelong CIC.",
            "DVIU (कम टिकाऊ), मूत्रमार्ग डाइलटेशन, पेरीनियल यूरेथ्रोस्टॉमी, आजीवन CIC।",
            "DVIU (ઓછી ટકાઉ), મૂત્રમાર્ગ ડાઇલેટેશન, પેરિનિયલ યુરેથ્રોસ્ટોમી, આજીવન CIC.",
        ),
    },
    # ────────── ANDROLOGY / GENITAL ──────────
    {
        "key": "vasectomy",
        "category": "Andrology",
        "anesthesia": "la",
        "name": _t(
            "Vasectomy (No-Scalpel)",
            "नसबंदी (बिना चीरा)",
            "નસબંધી (ચીરા વગર)",
        ),
        "procedure": _t(
            "Permanent male contraception by ligating and dividing both vasa deferens through a small puncture in the scrotum under local anaesthesia. ~15 minutes.",
            "स्थायी पुरुष गर्भनिरोधन के लिए, स्थानीय एनेस्थीसिया में अंडकोष में एक छोटे से छेद के माध्यम से दोनों वास डिफरेन्स को बांधा और काटा जाता है। ~15 मिनट।",
            "કાયમી પુરુષ ગર્ભનિરોધક માટે, સ્થાનિક એનેસ્થેસિયા હેઠળ વૃષણમાં નાના છિદ્ર દ્વારા બંને વાસ ડિફરન્સને બાંધવામાં અને કાપવામાં આવે છે. ~15 મિનિટ.",
        ),
        "specific_risks": [
            _t("Considered PERMANENT — counsel about reversal cost / success.", "स्थायी माना जाता है — रिवर्सल लागत/सफलता पर परामर्श आवश्यक।", "કાયમી ગણાય — રિવર્સલ ખર્ચ/સફળતા વિશે પરામર્શ જરૂરી."),
            _t("Use additional contraception until two negative semen analyses (~3 months).", "दो नकारात्मक वीर्य विश्लेषण (~3 महीने) तक अतिरिक्त गर्भनिरोधन का उपयोग करें।", "બે નકારાત્મક વીર્ય વિશ્લેષણ (~3 મહિના) સુધી વધારાનું ગર્ભનિરોધ વાપરો."),
            _t("Hematoma, scrotal swelling.", "हेमेटोमा, अंडकोष सूजन।", "હિમેટોમા, વૃષણ સોજો."),
            _t("Sperm granuloma, post-vasectomy pain syndrome (rare).", "शुक्राणु ग्रैनुलोमा, पोस्ट-नसबंदी दर्द सिंड्रोम (दुर्लभ)।", "સ્પર્મ ગ્રેન્યુલોમા, પોસ્ટ-નસબંધી દર્દ સિન્ડ્રોમ (દુર્લભ)."),
            _t("Recanalisation / failure (~1 in 2000).", "पुनः-नलीकरण / असफलता (~1 in 2000)।", "પુનઃ-નલિકાકરણ / નિષ્ફળતા (~1 in 2000)."),
        ],
        "alternatives": _t(
            "Female sterilisation, condoms, hormonal contraception for partner, IUCD, abstinence.",
            "महिला नसबंदी, कंडोम, साथी हेतु हार्मोनल गर्भनिरोधक, IUCD, संयम।",
            "સ્ત્રી નસબંધી, કોન્ડોમ, સાથી માટે હોર્મોનલ ગર્ભનિરોધ, IUCD, સંયમ.",
        ),
    },
    {
        "key": "vasovasostomy",
        "category": "Andrology",
        "anesthesia": "ga",
        "name": _t(
            "Vasovasostomy (Vasectomy Reversal)",
            "वासोवासोस्टॉमी (नसबंदी रिवर्सल)",
            "વાસોવાસોસ્ટોમી (વાસેક્ટમી રિવર્સલ)",
        ),
        "procedure": _t(
            "Microsurgical reconnection of the two ends of the vas deferens to restore fertility after vasectomy. Patency 70-95%, pregnancy 30-70% based on interval since vasectomy.",
            "નસબંદી કે બાદ પ્રજનન ક્ષમતા બહાલ કરને હેતુ વાસ ડિફરેન્સ કે દો સિરોં કા સૂક્ષ્મ-શલ્ય પુનર્સંધાન। 70-95% પેટेंसी, 30-70% ગર્ભાવસ્થા (અંતરાલ પર નિર્ભર)।",
            "વાસેક્ટમી પછી ફળદ્રુપતા પુનઃસ્થાપિત કરવા માટે વાસ ડિફરન્સના બે છેડાનું માઇક્રો-સર્જિકલ પુનઃજોડાણ. 70-95% પેટન્સી, 30-70% ગર્ભાવસ્થા (અંતરાલ આધારિત).",
        ),
        "specific_risks": [
            _t("Failure to achieve patency / pregnancy.", "पेटेंसी/गर्भावस्था प्राप्त करने में असफलता।", "પેટન્સી/ગર્ભાવસ્થા મેળવવામાં નિષ્ફળતા."),
            _t("Sperm granuloma, anti-sperm antibodies.", "शुक्राणु ग्रैनुलोमा, शुक्राणु-विरोधी एंटीबॉडी।", "સ્પર્મ ગ્રેન્યુલોમા, સ્પર્મ-વિરોધી એન્ટિબોડીઝ."),
            _t("Need for vaso-epididymostomy if blockage at epididymis.", "एपिडीडायमिस अवरोध होने पर वासो-एपिडीडायमोस्टॉमी।", "એપિડિડાયમિસ અવરોધ હોય તો વાસો-એપિડિડાયમોસ્ટોમી."),
        ],
        "alternatives": _t(
            "TESA + ICSI for IVF, donor sperm, adoption.",
            "TESA + ICSI द्वारा IVF, दाता स्पर्म, गोद लेना।",
            "TESA + ICSI દ્વારા IVF, દાતા સ્પર્મ, દત્તક લેવું.",
        ),
    },
    {
        "key": "varicocelectomy",
        "category": "Andrology",
        "anesthesia": "spinal",
        "name": _t(
            "Varicocelectomy (Microsurgical / Subinguinal)",
            "वैरिकोसीलेक्टॉमी (माइक्रोसर्जिकल / सबइंगुइनल)",
            "વેરિકોસીલેક્ટોમી (માઇક્રોસર્જિકલ / સબઇન્ગ્વિનલ)",
        ),
        "procedure": _t(
            "Ligation of dilated spermatic veins through a small groin incision under microscope to improve fertility, pain, or testicular atrophy.",
            "प्रजनन क्षमता, दर्द या वृषण क्षीणता में सुधार के लिए माइक्रोस्कोप के नीचे छोटे ग्रोइन चीरे के ज़रिए फैली हुई शुक्राणु नसों को बांधना।",
            "ફળદ્રુપતા, દર્દ અથવા ટેસ્ટિક્યુલર એટ્રોફી સુધારવા માટે માઇક્રોસ્કોપ હેઠળ નાના ગ્રોઇન કાપ દ્વારા વિસ્તૃત સ્પર્મેટિક નસોનું બંધન.",
        ),
        "specific_risks": [
            _t("Hydrocele formation (5-10%).", "हाइड्रोसील बनना (5-10%)।", "હાઇડ્રોસીલ બનવું (5-10%)."),
            _t("Recurrence (1-5%).", "पुनरावृत्ति (1-5%)।", "પુનરાવૃત્તિ (1-5%)."),
            _t("Testicular atrophy (very rare with microsurgery).", "वृषण क्षीणता (माइक्रोसर्जरी में बहुत दुर्लभ)।", "વૃષણ ક્ષય (માઇક્રો-સર્જરીમાં ખૂબ દુર્લભ)."),
            _t("No improvement in fertility despite repair.", "मरम्मत के बावजूद प्रजनन क्षमता में सुधार नहीं।", "મરામત છતાં ફળદ્રુપતામાં સુધારો નહીં."),
        ],
        "alternatives": _t(
            "Embolisation, observation if asymptomatic & no infertility, IVF/ICSI.",
            "एम्बोलाइज़ेशन, यदि लक्षणहीन एवं बंध्यता नहीं तो अवलोकन, IVF/ICSI।",
            "એમ્બોલાઇઝેશન, જો લક્ષણ વગર અને વંધ્યત્વ ન હોય તો અવલોકન, IVF/ICSI.",
        ),
    },
    {
        "key": "hydrocelectomy",
        "category": "Andrology",
        "anesthesia": "spinal",
        "name": _t(
            "Hydrocelectomy",
            "हाइड्रोसीलेक्टॉमी",
            "હાઇડ્રોસીલેક્ટોમી",
        ),
        "procedure": _t(
            "Surgical removal/eversion of the tunica vaginalis to drain a hydrocele (collection of fluid around the testis). Performed via scrotal incision.",
            "अंडकोष के चारों ओर तरल संचय (हाइड्रोसील) निकालने हेतु ट्यूनिका वैजिनालिस का सर्जिकल निष्कासन/उल्टाना। अंडकोष चीरे से।",
            "વૃષણની આસપાસ પ્રવાહી સંગ્રહ (હાઇડ્રોસીલ) દૂર કરવા માટે ટ્યુનિકા વેજિનાલિસનું સર્જિકલ નિષ્કાસન અથવા ઊલટાવવું. આ વૃષણ કોથળી પર ચીરા દ્વારા કરવામાં આવે છે.",
        ),
        "specific_risks": [
            _t("Recurrence (1-5%).", "पुनरावृत्ति (1-5%)।", "પુનરાવૃત્તિ (1-5%)."),
            _t("Scrotal hematoma, infection.", "अंडकोष hematoma, संक्रमण।", "વૃષણ હિમેટોમા, ચેપ."),
            _t("Testicular injury (rare).", "वृषण चोट (दुर्लभ)।", "વૃષણ ઈજા (દુર્લભ)."),
        ],
        "alternatives": _t(
            "Aspiration ± sclerotherapy (high recurrence), observation if asymptomatic.",
            "एस्पिरेशन ± स्केलेरोथेरेपी (उच्च पुनरावृत्ति), लक्षणहीन हो तो अवलोकन।",
            "એસ્પિરેશન ± સ્ક્લિરોથેરાપી (ઊંચી પુનરાવૃત્તિ), લક્ષણ વગર હોય તો અવલોકન.",
        ),
    },
    {
        "key": "orchidopexy",
        "category": "Andrology",
        "anesthesia": "ga",
        "name": _t(
            "Orchidopexy",
            "ऑर्किडोपेक्सी",
            "ઓર્કિડોપેક્સી",
        ),
        "procedure": _t(
            "Surgical fixation of an undescended or torsed testis into the scrotum. Performed under GA via inguinal/scrotal approach.",
            "undescended या मरोड़े हुए टेस्टिस को अंडकोष में फिक्स करने की सर्जरी। यह GA के तहत inguinal या scrotal रास्ते से की जाती है।",
            "નીચે ન ઉતરેલા અથવા વળાંક પામેલા વૃષણને અંડકોષમાં સ્થિર કરવાની સર્જરી. તે GA હેઠળ ઇન્ગ્વિનલ અથવા સ્ક્રોટલ માર્ગે કરવામાં આવે છે.",
        ),
        "specific_risks": [
            _t("Testicular atrophy (especially in salvage for torsion).", "वृषण क्षीणता (विशेषकर torsion के बचाव में)।", "વૃષણ ક્ષીણતા (ખાસ કરીને ટોર્ઝન બચાવમાં)."),
            _t("Re-ascent of testis (rare).", "वृषण का पुनः ऊपर जाना (दुर्लभ)।", "વૃષણનું ફરી ઉપર જવું (દુર્લભ)."),
            _t("Future infertility / cancer risk slightly higher than normal.", "भविष्य की बंध्यता / कैंसर जोखिम सामान्य से थोड़ा अधिक।", "ભવિષ્યમાં વંધ્યત્વ / કેન્સર જોખમ સામાન્ય કરતાં થોડું વધારે."),
        ],
        "alternatives": _t(
            "Hormonal therapy (less successful), orchidectomy if non-viable.",
            "हार्मोनल उपचार (कम सफल), अव्यवहार्य होने पर ऑर्किडेक्टॉमी।",
            "હોર્મોનલ સારવાર (ઓછી સફળ), અકાર્યક્ષમ હોય તો ઓર્કિડેક્ટોમી.",
        ),
    },
    {
        "key": "orchidectomy",
        "category": "Andrology",
        "anesthesia": "spinal",
        "name": _t(
            "Orchidectomy (Simple / Radical)",
            "ऑर्किडेक्टॉमी (सिंपल / रेडिकल)",
            "ઓર્કિડેક્ટોમી (સિંપલ / રેડિકલ)",
        ),
        "procedure": _t(
            "Removal of one or both testes for cancer (radical, via inguinal approach), atrophy, or hormone deprivation in advanced prostate cancer (simple/subcapsular, via scrotal approach).",
            "एक या दोनों टेस्टिस को कैंसर (रेडिकल, इन्गुइनल अप्रोच से), एट्रॉफी, या उन्नत प्रोस्टेट कैंसर में हार्मोन डिप्रिवेशन (सिंपल/सबकैप्सुलर, स्क्रोटल अप्रोच से) के लिए निकाला जाता है।",
            "કેન્સર (રેડિકલ, ઇન્ગ્વિનલ અપ્રોચથી), એટ્રોફી, અથવા અદ્યતન પ્રોસ્ટેટ કેન્સરમાં હોર્મોન ડિપ્રિવેશન (સિમ્પલ/સબકેપ્સ્યુલર, સ્ક્રોટલ અપ્રોચથી) માટે એક અથવા બંને ટેસ્ટિસ દૂર કરવામાં આવે છે.",
        ),
        "specific_risks": [
            _t("Loss of testicular hormone (testosterone) — may need replacement.", "वृषण हार्मोन (टेस्टोस्टेरोन) की हानि — रिप्लेसमेंट की ज़रूरत पड़ सकती है।", "વૃષણ હોર્મોન (ટેસ્ટોસ્ટેરોન) ની હાનિ — રિપ્લેસમેન્ટની જરૂર પડી શકે છે."),
            _t("Bilateral orchidectomy → infertility, hot flushes, osteoporosis risk.", "बायलैटरल ऑर्किडेक्टोमी: बंध्यता, हॉट फ्लश, ऑस्टियोपोरोसिस का जोखिम।", "બાયલેટરલ ઓર્કાઇડેક્ટોમી: વંધ્યત્વ, હોટ ફ્લશ, ઓસ્ટિયોપોરોસિસનું જોખમ."),
            _t("Body image issues — testicular prosthesis available.", "शरीर के स्वरूप को लेकर चिंता — वृषण प्रोस्थेसिस उपलब्ध।", "શરીરના સ્વરૂપને લઈને ચિંતા — વૃષણ પ્રોસ્થેસિસ ઉપલબ્ધ."),
        ],
        "alternatives": _t(
            "LHRH analogues for prostate cancer, partial orchidectomy in select tumours, observation for atrophy.",
            "प्रोस्टेट कैंसर हेतु LHRH एनालॉग, चयनित ट्यूमर हेतु आंशिक ऑर्किडेक्टॉमी, एट्रोफी हेतु अवलोकन।",
            "પ્રોસ્ટેટ કેન્સર માટે LHRH એનાલોગ, પસંદગીની ગાંઠો માટે આંશિક ઓર્કિડેક્ટોમી, ક્ષીણતા માટે અવલોકન.",
        ),
    },
    {
        "key": "circumcision",
        "category": "Minor Procedure",
        "anesthesia": "la",
        "name": _t(
            "Circumcision",
            "खतना",
            "ખતના",
        ),
        "procedure": _t(
            "Surgical removal of the foreskin under local/general anaesthesia for phimosis, recurrent balanitis, religious / cultural reasons, or paraphimosis.",
            "फिमोसिस, बार-बार बैलेनाइटिस, धार्मिक/सांस्कृतिक कारणों या पैराफिमोसिस के लिए foreskin को local या general anaesthesia देकर surgically हटाया जाता है।",
            "ફિમોસિસ, વારંવાર બેલેનાઇટિસ, ધાર્મિક/સાંસ્કૃતિક કારણો અથવા પેરાફિમોસિસ માટે foreskin ને local અથવા general anaesthesia આપીને surgically દૂર કરવામાં આવે છે.",
        ),
        "specific_risks": [
            _t("Bleeding from frenulum, hematoma.", "फ्रेनुलम से रक्तस्राव, हिमेटोमा।", "ફ્રેન્યુલમથી રક્તસ્રાવ, હિમેટોમા."),
            _t("Wound infection.", "घाव संक्रमण।", "ઘા ચેપ."),
            _t("Meatal stenosis, glans injury (rare).", "मीटल स्टेनोसिस, ग्लांस चोट (दुर्लभ)।", "મીટલ સ્ટેનોસિસ, ગ્લાન્સ ઈજા (દુર્લભ)."),
            _t("Cosmetic issues — minor asymmetry, skin bridges.", "कॉस्मेटिक मुद्दे — छोटी असममिति, स्किन ब्रिज।", "કોસ્મેટિક મુદ્દા — નાની અસમમિતિ, સ્કિન બ્રિજ."),
        ],
        "alternatives": _t(
            "Topical steroids for phimosis, dorsal slit, preputioplasty.",
            "फिमोसिस हेतु स्थानीय स्टेरॉयड, डॉर्सल स्लिट, प्रेप्यूशियोप्लास्टी।",
            "ફિમોસિસ માટે ટોપિકલ સ્ટેરોઇડ, ડોર્સલ સ્લિટ, પ્રેપ્યુશિયોપ્લાસ્ટી.",
        ),
    },
    {
        "key": "frenuloplasty",
        "category": "Minor Procedure",
        "anesthesia": "la",
        "name": _t(
            "Frenuloplasty",
            "फ्रेनुलोप्लास्टी",
            "ફ્રેન્યુલોપ્લાસ્ટી",
        ),
        "procedure": _t(
            "Lengthening of a tight frenulum (frenulum breve) by V-Y advancement to relieve pain on erection. ~10-15 minutes under local anaesthesia.",
            "स्थानीय एनेस्थीसिया में V-Y एडवांसमेंट तकनीक से तंग फ्रेनुलम को लंबा किया जाता है, जिससे इरेक्शन पर होने वाले दर्द से राहत मिलती है। इसमें लगभग 10-15 मिनट लगते हैं।",
            "સ્થાનિક એનેસ્થેસિયા હેઠળ V-Y એડવાન્સમેન્ટ ટેકનિકથી ચુસ્ત ફ્રેન્યુલમને લાંબુ કરવામાં આવે છે, જેથી ઇરેક્શન વખતે થતા દુખાવામાંથી રાહત મળે. આમાં લગભગ 10-15 મિનિટનો સમય લાગે છે.",
        ),
        "specific_risks": [
            _t("Mild bleeding, swelling.", "हल्का रक्तस्राव, सूजन।", "હળવો રક્તસ્રાવ, સોજો."),
            _t("Recurrence of tightness (rare).", "कसना वापस आ सकता है (दुर्लभ)।", "ચુસ્તતા ફરીથી થઈ શકે છે (દુર્લભ)."),
            _t("Avoid intercourse 2-3 weeks.", "2-3 सप्ताह संभोग न करें।", "2-3 અઠવાડિયા સંભોગ ન કરો."),
        ],
        "alternatives": _t(
            "Stretching exercises (limited efficacy), full circumcision.",
            "स्ट्रेचिंग व्यायाम (सीमित प्रभावकारिता), पूर्ण खतना।",
            "સ્ટ્રેચિંગ વ્યાયામ (મર્યાદિત અસરકારકતા), પૂર્ણ ખતના.",
        ),
    },
    {
        "key": "meatotomy",
        "category": "Minor Procedure",
        "anesthesia": "la",
        "name": _t(
            "Meatotomy / Meatoplasty",
            "मीटोटॉमी / मीटोप्लास्टी",
            "મીટોટોમી / મીટોપ્લાસ્ટી",
        ),
        "procedure": _t(
            "Surgical widening of a narrowed urethral meatus (meatal stenosis). Done under local or general anaesthesia.",
            "संकुचित urethral meatus (meatal stenosis) को स्थानीय या जनरल एनेस्थीसिया में सर्जरी द्वारा चौड़ा करना।",
            "સંકુચિત urethral meatus (meatal stenosis) ને સ્થાનિક અથવા જનરલ એનેસ્થેસિયા હેઠળ સર્જરી દ્વારા પહોળું કરવું.",
        ),
        "specific_risks": [
            _t("Bleeding, mild dysuria for a few days.", "रक्तस्राव, कुछ दिनों तक हल्की डिसयूरिया।", "રક્તસ્રાવ, થોડા દિવસ માટે હળવી ડિસ્યુરિયા."),
            _t("Recurrence of stenosis (10-15%).", "स्टेनोसिस पुनरावृत्ति (10-15%)।", "સ્ટેનોસિસ પુનરાવૃત્તિ (10-15%)."),
            _t("Spraying of urine stream.", "पेशाब की धार का बिखरना।", "પેશાબની ધારનું વિખેરાવું."),
        ],
        "alternatives": _t(
            "Self-dilatation, observation for asymptomatic cases.",
            "स्व-फैलाव, लक्षणहीन हेतु अवलोकन।",
            "સ્વ-ફેલાવણી, લક્ષણ વગર માટે અવલોકન.",
        ),
    },
    {
        "key": "hypospadias_repair",
        "category": "Reconstruction",
        "anesthesia": "ga",
        "name": _t(
            "Hypospadias Repair",
            "हाइपोस्पेडिअस रिपेयर",
            "હાઇપોસ્પેડિયસ રિપેર",
        ),
        "procedure": _t(
            "Reconstructive surgery to relocate the urethral meatus to the tip of the glans, correct chordee, and reconstruct the foreskin. Performed in stages depending on severity.",
            "यह एक रीकंस्ट्रक्टिव सर्जरी है, जिसमें मूत्रमार्ग के बाह्य द्वार को ग्लांस की नोक पर स्थानांतरित किया जाता है, कॉर्डी को ठीक किया जाता है और अग्रत्वचा का पुनर्निर्माण किया जाता है। इसकी गंभीरता के आधार पर इसे अलग-अलग चरणों में किया जाता है।",
            "આ એક રીકન્સ્ટ્રક્ટિવ સર્જરી છે, જેમાં મૂત્રમાર્ગના બાહ્ય દ્વારને ગ્લાન્સની ટોચ પર ખસેડવામાં આવે છે, કોર્ડી સુધારવામાં આવે છે અને ફોરસ્કિનનું પુનર્નિર્માણ કરવામાં આવે છે. તેની ગંભીરતાના આધારે, તે જુદા જુદા તબક્કામાં કરવામાં આવે છે.",
        ),
        "specific_risks": [
            _t("Urethrocutaneous fistula (10-20%) — may need second surgery.", "यूरेथ्रोक्यूटेनियस फिस्टुला (10-20%) — इसके लिए दूसरी सर्जरी की ज़रूरत पड़ सकती है।", "યુરેથ્રો-ક્યુટેનિયસ ફિસ્ટુલા (10-20%) — તેના માટે બીજી સર્જરીની જરૂર પડી શકે છે."),
            _t("Meatal stenosis, urethral diverticulum.", "मीटल स्टेनोसिस, मूत्रमार्ग डायवर्टिकुलम।", "મીટલ સ્ટેનોસિસ, મૂત્રમાર્ગ ડાયવર્ટિક્યુલમ."),
            _t("Glans dehiscence, residual chordee.", "ग्लांस विदारण, अवशिष्ट कॉर्डी।", "ગ્લાન્સ વિદારણ, બાકી રહેલ કોર્ડી."),
            _t("May need multiple procedures over years.", "सालों तक कई प्रक्रियाओं की ज़रूरत पड़ सकती है।", "વર્ષો સુધી અનેક પ્રક્રિયાઓની જરૂર પડી શકે છે."),
        ],
        "alternatives": _t(
            "Observation for very mild distal hypospadias, perineal urethrostomy in salvage.",
            "बहुत हल्के डिस्टल hypospadias के लिए अवलोकन, बचाव में पेरीनियल यूरेथ्रोस्टॉमी।",
            "ખૂબ હળવા ડિસ્ટલ hypospadias માટે અવલોકન, બચાવમાં પેરિનિયલ યુરેથ્રોસ્ટોમી.",
        ),
    },
    {
        "key": "penile_implant",
        "category": "Andrology",
        "anesthesia": "spinal",
        "name": _t(
            "Penile Prosthesis Implantation",
            "पीनाइल प्रोस्थेसिस इम्प्लांटेशन",
            "પેનાઇલ પ્રોસ્થેસિસ ઇમ્પ્લાન્ટેશન",
        ),
        "procedure": _t(
            "Surgical implantation of an inflatable or malleable device into the corpora cavernosa for refractory erectile dysfunction. Day-care or 1-night stay.",
            "रिफ्रैक्टरी स्तंभन दोष हेतु कॉर्पोरा कैवर्नोसा में इन्फ्लैटेबल/मैलिएबल उपकरण का सर्जिकल इम्प्लांटेशन। डे-केयर या 1 रात का स्टे।",
            "રિફ્રેક્ટરી ઇરેક્ટાઇલ ડિસફંક્શન માટે કોર્પોરા કેવર્નોસામાં ઇન્ફ્લેટેબલ/મેલિએબલ ઉપકરણનું સર્જિકલ ઇમ્પ્લાન્ટેશન. ડે-કેર અથવા 1 રાતનો સ્ટે.",
        ),
        "specific_risks": [
            _t("Device infection (1-3%) — may need explantation.", "उपकरण संक्रमण (1-3%) — एक्सप्लांटेशन की ज़रूरत पड़ सकती है।", "ઉપકરણ ચેપ (1-3%) — એક્સપ્લાન્ટેશનની જરૂર પડી શકે છે."),
            _t("Mechanical failure (~5% in 5 years).", "यांत्रिक विफलता (5 वर्षों में ~5%)।", "યાંત્રિક નિષ્ફળતા (5 વર્ષમાં ~5%)."),
            _t("Erosion through skin / urethra.", "त्वचा/मूत्रमार्ग से इरोज़न।", "ત્વચા/મૂત્રમાર્ગમાંથી ઈરોઝન."),
            _t("Loss of natural erection — irreversible.", "प्राकृतिक इरेक्शन का नुकसान — अपरिवर्तनीय।", "કુદરતી ઇરેક્શનનું નુકસાન — અપરિવર્તનીય."),
            _t("Slight shortening of penile length.", "लिंग की लंबाई में थोड़ी कमी।", "લિંગની લંબાઈમાં થોડો ઘટાડો."),
        ],
        "alternatives": _t(
            "Oral PDE5 inhibitors, intracavernosal injections, vacuum erection device, sex therapy.",
            "मौखिक PDE5 अवरोधक, इंट्राकैवर्नोसल इंजेक्शन, वैक्यूम स्तंभन उपकरण, यौन चिकित्सा।",
            "મૌખિક PDE5 અવરોધકો, ઇન્ટ્રાકેવર્નોસલ ઇન્જેક્શન, વેક્યુમ ઇરેક્શન ડિવાઇસ, સેક્સ થેરાપી.",
        ),
    },
    {
        "key": "penile_mass_excision",
        "category": "Oncology",
        "anesthesia": "ga",
        "name": _t(
            "Excision of Penile / Scrotal Mass",
            "लिंग / अंडकोष मास निकालना",
            "પેનાઇલ / વૃષણ માસ કાઢવું",
        ),
        "procedure": _t(
            "Surgical excision with adequate margin of a suspicious or biopsy-proven penile/scrotal lesion. Frozen-section may be done; pathology guides further treatment.",
            "संदिग्ध या बायोप्सी-प्रमाणित penile/scrotal लीज़न का पर्याप्त मार्जिन के साथ सर्जिकल एक्सिज़न किया जाता है। फ्रोज़न-सेक्शन की जांच भी की जा सकती है; पैथोलॉजी आगे के उपचार का मार्गदर्शन करती है।",
            "શંકાસ્પદ અથવા બાયોપ્સી-પ્રુવન penile/scrotal લીઝનનું પૂરતા માર્જિન સાથે સર્જિકલ એક્સિઝન કરવામાં આવે છે. ફ્રોઝન-સેક્શનની તપાસ પણ થઈ શકે છે; પેથોલોજી આગળની સારવારનું માર્ગદર્શન કરે છે.",
        ),
        "specific_risks": [
            _t("Cosmetic defect, scarring.", "कॉस्मेटिक दोष, निशान।", "કોસ્મેટિક ખામી, ડાઘ."),
            _t("Need for further surgery (partial / total penectomy) based on pathology.", "पैथोलॉजी के आधार पर आगे की सर्जरी (आंशिक/पूर्ण पेनेक्टोमी)।", "પેથોલોજી અનુસાર આગળની સર્જરી (આંશિક/સંપૂર્ણ પેનેક્ટોમી)."),
            _t("Lymph node dissection if invasive cancer.", "आक्रामक कैंसर में लसिका ग्रंथि विच्छेदन।", "આક્રમક કેન્સરમાં લસિકા ગ્રંથિ વિચ્છેદન."),
        ],
        "alternatives": _t(
            "Topical chemotherapy (Imiquimod, 5-FU) for superficial Tis, laser ablation, observation if benign biopsy.",
            "सतही Tis हेतु स्थानीय कीमोथेरेपी (इमिक्विमॉड, 5-FU), लेज़र अबलेशन, सौम्य बायोप्सी हो तो अवलोकन।",
            "સપાટી Tis માટે ટોપિકલ કેમોથેરાપી (ઇમિક્વિમોડ, 5-FU), લેઝર એબ્લેશન, સૌમ્ય બાયોપ્સી હોય તો અવલોકન.",
        ),
    },
    {
        "key": "spermatic_cord_block",
        "category": "Minor Procedure",
        "anesthesia": "la",
        "name": _t(
            "Spermatic Cord Block / Hydrocele Aspiration",
            "स्पर्मेटिक कॉर्ड ब्लॉक / हाइड्रोसील एस्पिरेशन",
            "સ્પર્મેટિક કોર્ડ બ્લોક / હાઇડ્રોસીલ એસ્પિરેશન",
        ),
        "procedure": _t(
            "Percutaneous local anaesthetic injection around the spermatic cord for chronic testicular pain or therapeutic aspiration of a hydrocele. Outpatient procedure.",
            "क्रोनिक वृषण दर्द हेतु स्पर्मेटिक कॉर्ड के चारों ओर पर्क्यूटेनियस स्थानीय एनेस्थेटिक इंजेक्शन या हाइड्रोसील का चिकित्सीय एस्पिरेशन। ओपीडी प्रक्रिया।",
            "ક્રોનિક વૃષણ દર્દ માટે સ્પર્મેટિક કોર્ડની આસપાસ પર્ક્યુટેનિયસ સ્થાનિક એનેસ્થેટિક ઇન્જેક્શન અથવા હાઇડ્રોસીલનું ઉપચારાત્મક એસ્પિરેશન. ઓપીડી પ્રક્રિયા.",
        ),
        "specific_risks": [
            _t("Local bruising, transient pain.", "स्थानीय हल्का नील, अल्पकालिक दर्द।", "સ્થાનિક હળવો ઉઝરડો, થોડા સમય માટે દર્દ."),
            _t("High recurrence after aspiration (~80% within months).", "एस्पिरेशन के बाद उच्च पुनरावृत्ति (~80% महीनों में)।", "એસ્પિરેશન બાદ ઊંચી પુનરાવૃત્તિ (~80% મહિનાઓમાં)."),
            _t("Vasovagal reaction (rare).", "वासोवेगल प्रतिक्रिया (दुर्लभ)।", "વાસોવેગલ પ્રતિક્રિયા (દુર્લભ)."),
        ],
        "alternatives": _t(
            "Surgical hydrocelectomy (definitive), microsurgical denervation for chronic pain.",
            "सर्जिकल हाइड्रोसीलेक्टॉमी (निश्चित), क्रोनिक दर्द हेतु माइक्रोसर्जिकल डीनरवेशन।",
            "સર્જિકલ હાઇડ્રોસીલેક્ટોમી (નિશ્ચિત), ક્રોનિક દર્દ માટે માઇક્રો-સર્જિકલ ડિનર્વેશન.",
        ),
    },
    # ────────── TRANSPLANT ──────────
    {
        "key": "kidney_transplant_recipient",
        "category": "Transplant",
        "anesthesia": "ga",
        "name": _t(
            "Kidney Transplantation — Recipient",
            "गुर्दा प्रत्यारोपण — प्राप्तकर्ता",
            "કિડની ટ્રાન્સપ્લાન્ટેશન — પ્રાપ્તકર્તા",
        ),
        "procedure": _t(
            "Heterotopic placement of a donor kidney into the right or left iliac fossa with vascular and ureteric anastomosis. Lifelong immunosuppression required.",
            "दाता किडनी का दाएं या बाएं इलियक फोसा में हेटरोटॉपिक स्थापन; वैस्कुलर और यूरेटरिक एनास्टोमोसिस। आजीवन इम्यूनोसप्रेशन आवश्यक।",
            "દાતા કિડનીને જમણી અથવા ડાબી ઇલિયક ફોસામાં હેટરોટોપિક રીતે મૂકવી; વૅસ્ક્યુલર અને યુરેટરિક એનાસ્ટોમોસિસ. આજીવન ઇમ્યુનોસપ્રેશન જરૂરી.",
        ),
        "specific_risks": [
            _t("Acute rejection (20-30% in 1st year) — needs increased immunosuppression.", "तीव्र अस्वीकृति (पहले वर्ष में 20-30%) — बढ़ी हुई इम्यूनोसप्रेशन की आवश्यकता।", "તીવ્ર અસ્વીકૃતિ (પહેલા વર્ષમાં 20-30%) — વધારાનું ઇમ્યુનોસપ્રેશન જરૂરી."),
            _t("Chronic rejection / allograft loss over years.", "समय के साथ क्रोनिक अस्वीकृति / एलोग्राफ्ट हानि", "સમય જતાં ક્રોનિક અસ્વીકૃતિ / એલોગ્રાફ્ટ હાનિ"),
            _t("Vascular complications (renal artery / vein thrombosis, lymphocele).", "संवहनी जटिलताएं (गुर्दे की धमनी/शिरा थ्रोम्बोसिस, लिम्फोसील)।", "વાહિની જટિલતાઓ (કિડની ધમની/શિરા થ્રોમ્બોસિસ, લિમ્ફોસીલ)."),
            _t("Urological complications (leak, stricture, reflux).", "मूत्र संबंधी जटिलताएं (रिसाव, संकुचन, रिफ्लक्स)।", "મૂત્ર સંબંધિત જટિલતાઓ (લીકેજ, સંકોચન, રિફ્લક્સ)."),
            _t("Immunosuppression side-effects — infection, malignancy (PTLD, skin), DM, HTN, weight gain.", "इम्यूनोसप्रेशन दुष्प्रभाव — संक्रमण, कैंसर (PTLD, त्वचा), DM, HTN, वजन बढ़ना।", "ઇમ્યુનોસપ્રેશન આડઅસરો — ચેપ, કેન્સર (PTLD, ત્વચા), DM, HTN, વજન વધવું."),
            _t("Recurrent native disease in allograft.", "एलोग्राफ्ट में मूल रोग की पुनरावृत्ति।", "એલોગ્રાફ્ટમાં મૂળ રોગની પુનરાવૃત્તિ."),
        ],
        "alternatives": _t(
            "Continued haemodialysis or peritoneal dialysis, conservative care.",
            "जारी हीमोडायलिसिस या पेरिटोनियल डायलिसिस, सहायक देखभाल।",
            "ચાલુ હીમોડાયાલિસિસ અથવા પેરિટોનિયલ ડાયાલિસિસ, આધારભૂત સંભાળ.",
        ),
    },
    {
        "key": "donor_nephrectomy",
        "category": "Transplant",
        "anesthesia": "ga",
        "name": _t(
            "Live Donor Nephrectomy",
            "जीवित दाता नेफ्रेक्टॉमी",
            "જીવિત દાતા નેફ્રેક્ટોમી",
        ),
        "procedure": _t(
            "Removal of one healthy kidney from a living donor for transplantation into a recipient. Performed laparoscopically (preferred) or open.",
            "प्राप्तकर्ता में ट्रांसप्लांटेशन के लिए एक जीवित डोनर से एक स्वस्थ किडनी का निष्कासन। यह laparoscopically (पसंदीदा) या open तरीके से की जाती है।",
            "પ્રાપ્તકર્તામાં ટ્રાન્સપ્લાન્ટેશન માટે એક જીવિત ડોનર પાસેથી એક સ્વસ્થ કિડની દૂર કરવી. આ laparoscopically (પસંદગીનું) અથવા open રીતે કરવામાં આવે છે.",
        ),
        "specific_risks": [
            _t("Donor mortality 1 in 3000 — VERY rare but real.", "दाता मृत्यु दर 3000 में 1 — बहुत दुर्लभ परंतु वास्तविक।", "દાતા મૃત્યુદર 3000માં 1 — ખૂબ દુર્લભ પણ વાસ્તવિક."),
            _t("Major bleeding requiring transfusion (~1%).", "प्रमुख रक्तस्राव जिसमें ब्लड ट्रांसफ़्यूज़न की ज़रूरत पड़े (~1%)।", "મુખ્ય રક્તસ્રાવ જેમાં બ્લડ ટ્રાન્સફ્યુઝનની જરૂર પડે (~1%)."),
            _t("Future risk of hypertension, slight reduction in kidney function (compensated by remaining kidney).", "भविष्य में उच्च-रक्तचाप जोखिम, गुर्दा कार्य में थोड़ी कमी (शेष गुर्दे द्वारा भरपाई)।", "ભવિષ્યમાં હાઇપરટેન્શન જોખમ, કિડની કાર્યમાં થોડો ઘટાડો (બાકીની કિડની દ્વારા સરભર)."),
            _t("Pregnancy considerations for women donors.", "महिला दाताओं हेतु गर्भावस्था संबंधी विचारणीय बातें।", "સ્ત્રી દાતાઓ માટે ગર્ભાવસ્થા સંબંધિત વિચારણાઓ."),
            _t("Lifelong follow-up of kidney function (annual creatinine, BP, urine).", "किडनी कार्य की आजीवन निगरानी (वार्षिक क्रिएटिनिन, BP, मूत्र)।", "કિડની કાર્યનું આજીવન નિરીક્ષણ (વાર્ષિક ક્રિએટિનિન, BP, મૂત્ર)."),
        ],
        "alternatives": _t(
            "Recipient remains on dialysis or on the deceased donor waiting list.",
            "प्राप्तकर्ता डायलिसिस पर रहता है या मृत दाता प्रतीक्षा सूची पर।",
            "પ્રાપ્તકર્તા ડાયાલિસિસ પર રહે છે અથવા મૃત દાતા પ્રતીક્ષા યાદી પર.",
        ),
    },
    {
        "key": "av_fistula",
        "category": "Reconstruction",
        "anesthesia": "la",
        "name": _t(
            "Arteriovenous Fistula Creation (for Dialysis)",
            "आर्टेरियोवेनस फिस्टुला निर्माण (डायलिसिस हेतु)",
            "આર્ટેરિઓવેનસ ફિસ્ટુલા સર્જન (ડાયાલિસિસ માટે)",
        ),
        "procedure": _t(
            "Surgical creation of a connection between a forearm artery and vein under local anaesthesia for vascular access during haemodialysis. Maturation takes 6-12 weeks.",
            "हीमोडायलिसिस (Haemodialysis) के लिए vascular access बनाने के लिए, लोकल एनेस्थीसिया (local anaesthesia) देकर अग्रबाहु की एक artery और vein के बीच surgically एक कनेक्शन (connection) बनाया जाता है। इसे मैच्योर (mature) होने में 6-12 हफ्ते लगते हैं।",
            "હીમોડાયાલિસિસ (Haemodialysis) માટે vascular access બનાવવા માટે, લોકલ એનેસ્થેસિયા (local anaesthesia) આપીને આગળના હાથની એક artery અને vein વચ્ચે સર્જિકલી એક કનેક્શન (connection) બનાવવામાં આવે છે. તેને મેચ્યોર (mature) થવામાં 6-12 અઠવાડિયા લાગે છે.",
        ),
        "specific_risks": [
            _t("Failure to mature (10-30%) — may need angioplasty or revision.", "परिपक्व न होना (10-30%) — इसके लिए एंजियोप्लास्टी या संशोधन की ज़रूरत पड़ सकती है।", "પરિપક્વ ન થવું (10-30%) — જેને માટે એન્જિયોપ્લાસ્ટી કે રિવિઝનની જરૂર પડી શકે છે."),
            _t("Steal syndrome — hand ischaemia (1-5%).", "स्टील सिंड्रोम — हाथ इस्केमिया (1-5%)", "સ્ટીલ સિન્ડ્રોમ — હાથમાં ઇસ્કેમિયા (1-5%)"),
            _t("Aneurysm formation, thrombosis, infection.", "एनीरिज़्म, थ्रोम्बोसिस, संक्रमण।", "એન્યુરિઝમ, થ્રોમ્બોસિસ, ચેપ."),
        ],
        "alternatives": _t(
            "AV graft, tunnelled central catheter, peritoneal dialysis, transplantation.",
            "AV ग्राफ्ट, टनल्ड केंद्रीय कैथेटर, पेरिटोनियल डायलिसिस, प्रत्यारोपण।",
            "AV ગ્રાફ્ટ, ટનલ્ડ સેન્ટ્રલ કેથેટર, પેરિટોનિયલ ડાયાલિસિસ, ટ્રાન્સપ્લાન્ટ.",
        ),
    },
    # ────────── ONCOLOGY THERAPIES (intravesical) ──────────
    {
        "key": "bcg_instillation",
        "category": "Oncology",
        "anesthesia": "none",
        "name": _t(
            "Intravesical BCG Instillation",
            "इंट्रावेसिकल BCG इंस्टिलेशन",
            "ઇન્ટ્રાવેસિકલ BCG ઇન્સ્ટિલેશન",
        ),
        "procedure": _t(
            "Catheter-delivered live attenuated TB vaccine (BCG) into the bladder for high-grade non-muscle-invasive bladder cancer. Weekly induction (6 doses) then maintenance.",
            "उच्च-श्रेणी नॉन-मसल इनवेसिव ब्लैडर कैंसर के लिए कैथेटर द्वारा ब्लैडर में BCG (टीबी वैक्सीन) डाली जाती है। इसमें साप्ताहिक इंडक्शन (6 डोज़) और फिर मेंटेनेंस दी जाती है।",
            "ઉચ્ચ-ગ્રેડ નૉન-મસલ ઇન્વેઝિવ બ્લૅડર કૅન્સર માટે કેથેટર દ્વારા બ્લૅડરમાં BCG (ટીબી વૅક્સિન) નાખવામાં આવે છે. તેમાં સાપ્તાહિક ઇન્ડક્શન (6 ડોઝ) અને પછી મેઇન્ટેનન્સ આપવામાં આવે છે.",
        ),
        "specific_risks": [
            _t("Cystitis-like symptoms (frequency, dysuria) — usually 1-2 days.", "सिस्टाइटिस जैसे लक्षण (बार-बार, डिसयूरिया) — आमतौर पर 1-2 दिन।", "સિસ્ટાઇટિસ જેવા લક્ષણો (વારંવાર, ડિસ્યુરિયા) — સામાન્ય રીતે 1-2 દિવસ."),
            _t("Fever, malaise, BCG sepsis (rare but serious).", "बुखार, अस्वस्थता, BCG सेप्सिस (दुर्लभ परंतु गंभीर)।", "તાવ, અસ્વસ્થતા, BCG સેપ્સિસ (દુર્લભ પણ ગંભીર)."),
            _t("Granulomatous prostatitis, epididymitis, renal involvement.", "ग्रैनुलोमेटस प्रोस्टेटाइटिस, एपिडीडायमाइटिस, गुर्दे की भागीदारी।", "ગ્રેન્યુલોમેટસ પ્રોસ્ટેટાઇટિસ, એપિડિડાયમાઇટિસ, કિડની સંડોવણી."),
            _t("Allergic reactions to BCG.", "BCG से एलर्जी प्रतिक्रिया।", "BCG થી એલર્જિક પ્રતિક્રિયા."),
        ],
        "alternatives": _t(
            "Intravesical mitomycin C, gemcitabine, valrubicin, surveillance, radical cystectomy in BCG failures.",
            "इंट्रावेसिकल माइटोमाइसिन C, जेमसिटाबाइन, वालरुबिसिन, निगरानी, BCG विफलता पर रेडिकल सिस्टेक्टोमी।",
            "ઇન્ટ્રાવેસિકલ માઇટોમાઇસિન C, જેમસિટાબાઇન, વાલરુબિસિન, નિરીક્ષણ, BCG નિષ્ફળતા પર રેડિકલ સિસ્ટેક્ટોમી.",
        ),
    },
    {
        "key": "intravesical_mmc",
        "category": "Oncology",
        "anesthesia": "none",
        "name": _t(
            "Intravesical Mitomycin C (MMC)",
            "इंट्रावेसिकल माइटोमाइसिन C (MMC)",
            "ઇન્ટ્રાવેસિકલ માઇટોમાઇસિન C (MMC)",
        ),
        "procedure": _t(
            "Single dose post-TURBT or weekly chemotherapy courses delivered via catheter for low-/intermediate-risk bladder cancer.",
            "निम्न/मध्यम जोखिम मूत्राशय कैंसर हेतु पोस्ट-TURBT एक खुराक या साप्ताहिक कीमोथेरेपी कोर्स कैथेटर द्वारा।",
            "નિમ્ન/મધ્યમ-જોખમી મૂત્રાશય કેન્સર માટે પોસ્ટ-TURBT એક ડોઝ અથવા સાપ્તાહિક કેમોથેરાપી કોર્સ કેથેટર દ્વારા.",
        ),
        "specific_risks": [
            _t("Chemical cystitis — burning, frequency for 1-3 days.", "रासायनिक सिस्टाइटिस — 1-3 दिनों तक जलन, बार-बार पेशाब आना।", "રાસાયણિક સિસ્ટાઇટિસ — 1-3 દિવસ બળતરા, વારંવાર પેશાબ થવો."),
            _t("Local skin reaction if leakage at catheter site.", "कैथेटर स्थल पर रिसाव होने पर स्थानीय त्वचा प्रतिक्रिया।", "કેથેટર સ્થળે લીકેજ થાય તો સ્થાનિક ત્વચા પ્રતિક્રિયા."),
            _t("Bladder contracture (rare with prolonged use).", "लंबे उपयोग पर मूत्राशय संकुचन (दुर्लभ)।", "લાંબા ઉપયોગ પર મૂત્રાશય સંકોચન (દુર્લભ)."),
        ],
        "alternatives": _t(
            "BCG, gemcitabine, observation, valrubicin.",
            "BCG, जेमसिटाबाइन, अवलोकन, वालरुबिसिन।",
            "BCG, જેમસિટાબાઇન, અવલોકન, વાલરુબિસિન.",
        ),
    },
    # ────────── FUNCTIONAL UROLOGY ──────────
    {
        "key": "aus_implant",
        "category": "Functional",
        "anesthesia": "ga",
        "name": _t(
            "Artificial Urinary Sphincter (AUS) Implantation",
            "आर्टिफिशियल यूरिनरी स्फिंक्टर (AUS) इम्प्लांटेशन",
            "આર્ટિફિશિયલ યુરિનરી સ્ફિન્ક્ટર (AUS) ઇમ્પ્લાન્ટેશન",
        ),
        "procedure": _t(
            "Surgical placement of a 3-component hydraulic device (cuff around urethra, pump in scrotum, balloon reservoir) for severe stress incontinence after prostate surgery.",
            "प्रोस्टेट सर्जरी के बाद गंभीर स्ट्रेस इन्कंटिनेंस के लिए 3-कंपोनेंट हाइड्रोलिक डिवाइस (urethra के चारों ओर कफ, scrotum में पंप, बैलून रिज़र्वायर) का सर्जिकल प्लेसमेंट।",
            "પ્રોસ્ટેટ સર્જરી પછી તીવ્ર સ્ટ્રેસ ઇન્કૉન્ટિનન્સ માટે 3-કમ્પોનન્ટ હાઇડ્રોલિક ડિવાઇસ (urethra ની આસપાસ કફ, scrotum માં પંપ, બલૂન રિઝર્વોયર) નું સર્જિકલ પ્લેસમેન્ટ.",
        ),
        "specific_risks": [
            _t("Mechanical failure (~10% in 5 years).", "यांत्रिक विफलता (5 वर्षों में ~10%)।", "યાંત્રિક નિષ્ફળતા (5 વર્ષમાં ~10%)."),
            _t("Cuff erosion / urethral atrophy — may need explant.", "कफ क्षरण / मूत्रमार्ग क्षीणता — जिसके लिए एक्सप्लांट करना पड़ सकता है।", "કફ ઈરોઝન / મૂત્રમાર્ગ ક્ષય — જેના માટે એક્સપ્લાન્ટ કરાવવાની જરૂર પડી શકે છે."),
            _t("Device infection (1-3%).", "उपकरण संक्रमण (1-3%)।", "ઉપકરણ ચેપ (1-3%)."),
            _t("Difficulty using pump (manual dexterity issues).", "पंप उपयोग में कठिनाई (हस्त कौशल मुद्दे)।", "પમ્પ વાપરવામાં મુશ્કેલી (હસ્ત કૌશલ્ય મુદ્દા)."),
        ],
        "alternatives": _t(
            "Male slings, periurethral bulking, condom catheter, pads.",
            "पुरुष स्लिंग, पेरीयूरेथ्रल बल्किंग, कंडोम कैथेटर, पैड्स।",
            "પુરૂષ સ્લિંગ, પેરિયુરેથ્રલ બલ્કિંગ, કોન્ડોમ કેથેટર, પેડ્સ.",
        ),
    },
    {
        "key": "sui_sling",
        "category": "Functional",
        "anesthesia": "spinal",
        "name": _t(
            "Sling Surgery for Stress Urinary Incontinence",
            "स्ट्रेस मूत्र असंयम हेतु स्लिंग सर्जरी",
            "સ્ટ્રેસ યુરિનરી અસંયમ માટે સ્લિંગ સર્જરી",
        ),
        "procedure": _t(
            "Placement of a synthetic mesh tape (TVT/TOT) under the mid-urethra (women) or bulbar urethra (men) to support the urethra during stress events.",
            "स्ट्रेस इवेंट्स के दौरान मूत्रमार्ग को सपोर्ट देने के लिए मध्य-मूत्रमार्ग (महिलाओं में) या बल्बर-मूत्रमार्ग (पुरुषों में) के नीचे सिंथेटिक मेश टेप (TVT/TOT) लगाना।",
            "સ્ટ્રેસ ઇવેન્ટ્સ દરમિયાન મૂત્રમાર્ગને સપોર્ટ આપવા માટે મધ્ય-મૂત્રમાર્ગ (સ્ત્રી) અથવા બલ્બર-મૂત્રમાર્ગ (પુરૂષ) નીચે સિન્થેટિક મેશ ટેપ (TVT/TOT) મૂકવી.",
        ),
        "specific_risks": [
            _t("Mesh erosion into urethra / vagina.", "यूरेथ्रा/वजाइना में मेश इरोजन।", "યુરેથ્રા/વજાઈના માં મેશ ઈરોઝન."),
            _t("Voiding difficulty / retention — may need cutting the sling.", "मूत्र त्याग में कठिनाई / रिटेंशन — स्लिंग को काटना पड़ सकता है।", "મૂત્ર ત્યાગ મુશ્કેલી / રિટેન્શન — સ્લિંગ કાપવો પડી શકે છે."),
            _t("Bladder / urethral injury during placement.", "स्थापन के दौरान मूत्राशय/मूत्रमार्ग चोट।", "મૂકવા દરમિયાન મૂત્રાશય/મૂત્રમાર્ગ ઈજા."),
            _t("Recurrence of incontinence.", "असंयम पुनरावृत्ति।", "અસંયમ પુનરાવૃત્તિ."),
            _t("Chronic groin / pelvic pain.", "क्रोनिक ग्रोइन/पेल्विक दर्द।", "ક્રોનિક ગ્રોઇન/પેલ્વિક દર્દ."),
        ],
        "alternatives": _t(
            "Pelvic floor exercises, vaginal pessary, periurethral bulking, Burch colposuspension, AUS in men.",
            "पेल्विक फ्लोर व्यायाम, योनि पेसरी, पेरीयूरेथ्रल बल्किंग, बर्च कोल्पोसस्पेंशन, पुरुषों में AUS।",
            "પેલ્વિક ફ્લોર વ્યાયામ, યોનિ પેસરી, પેરિયુરેથ્રલ બલ્કિંગ, બર્ચ કોલ્પોસસ્પેન્શન, પુરૂષોમાં AUS.",
        ),
    },
    {
        "key": "botox_bladder",
        "category": "Functional",
        "anesthesia": "la",
        "name": _t(
            "Intravesical Botox Injection",
            "इंट्रावेसिकल बोटॉक्स इंजेक्शन",
            "ઇન્ટ્રાવેસિકલ બોટોક્સ ઇન્જેક્શન",
        ),
        "procedure": _t(
            "Cystoscopic injection of botulinum toxin into the bladder muscle for refractory overactive bladder or neurogenic detrusor overactivity. Effect lasts 6-9 months.",
            "रिफ्रैक्टरी overactive bladder या neurogenic detrusor overactivity के लिए Cystoscopy द्वारा मूत्राशय की मांसपेशी में botulinum toxin injection। प्रभाव 6-9 महीने।",
            "રિફ્રેક્ટરી overactive bladder અથવા neurogenic detrusor overactivity માટે Cystoscopy થી મૂત્રાશય સ્નાયુમાં botulinum toxin injection. અસર 6-9 મહિના.",
        ),
        "specific_risks": [
            _t("Urinary retention requiring CIC (5-15%).", "मूत्र रुक जाना, जिसके लिए CIC की ज़रूरत पड़ सकती है (5-15%)।", "પેશાબ રોકાઈ જવો, જેના માટે CICની જરૂર પડી શકે છે (5-15%)."),
            _t("Urinary tract infection.", "मूत्र मार्ग संक्रमण।", "મૂત્રમાર્ગ ચેપ."),
            _t("Hematuria, bladder pain.", "हेमाट्यूरिया, ब्लैडर दर्द।", "હેમેટ્યુરિયા, બ્લેડર દર્દ."),
            _t("Need for repeat every 6-9 months.", "हर 6-9 महीने में दोहराव की आवश्यकता।", "દર 6-9 મહિને પુનરાવર્તનની જરૂર."),
        ],
        "alternatives": _t(
            "Anticholinergics, beta-3 agonists, sacral neuromodulation, posterior tibial nerve stimulation, augmentation cystoplasty.",
            "एंटीकोलिनर्जिक्स, बीटा-3 एगोनिस्ट, सैक्रल न्यूरोमॉड्यूलेशन, पोस्टीरियर टिबियल तंत्रिका उत्तेजना, ऑगमेंटेशन सिस्टोप्लास्टी।",
            "એન્ટિકોલિનર્જિક્સ, બીટા-3 એગોનિસ્ટ, સેક્રલ ન્યુરોમોડ્યુલેશન, પોસ્ટિરિયર ટિબિયલ ચેતા ઉત્તેજના, ઓગમેન્ટેશન સિસ્ટોપ્લાસ્ટી.",
        ),
    },
    {
        "key": "sacral_neuromodulation",
        "category": "Functional",
        "anesthesia": "la",
        "name": _t(
            "Sacral Neuromodulation (InterStim)",
            "सैक्रल न्यूरोमॉड्यूलेशन (इंटरस्टिम)",
            "સેક્રલ ન્યુરોમોડ્યુલેશન (ઇન્ટરસ્ટિમ)",
        ),
        "procedure": _t(
            "Placement of a small electrode near the S3 nerve root with a pulse generator under the skin, for refractory urgency, frequency, urgency-incontinence, or non-obstructive retention.",
            "रिफ्रैक्टरी अर्जेंसी, फ्रीक्वेंसी, अर्जेंसी-इनकॉन्टिनेंस या नॉन-ऑब्सट्रक्टिव रिटेंशन हेतु S3 नर्व रूट के पास एक छोटे इलेक्ट्रोड और पल्स जनरेटर का त्वचा के नीचे स्थापन।",
            "રિફ્રેક્ટરી અર્જન્સી, ફ્રીક્વન્સી, અર્જન્સી-ઇનકોન્ટીનન્સ અથવા નોન-ઓબ્સ્ટ્રક્ટિવ રિટેન્શન માટે S3 નર્વ રૂટ પાસે એક નાના ઇલેક્ટ્રોડ અને પલ્સ જનરેટરનું ત્વચા હેઠળ સ્થાપન.",
        ),
        "specific_risks": [
            _t("Lead migration (5-10%) requiring revision.", "लीड माइग्रेशन (5-10%) — संशोधन की आवश्यकता।", "લીડ માઇગ્રેશન (5-10%) — સંશોધન જરૂરી."),
            _t("Pain at implant site.", "इम्प्लांट स्थल पर दर्द।", "ઇમ્પ્લાન્ટ સ્થળે દર્દ."),
            _t("Device infection.", "उपकरण संक्रमण।", "ઉપકરણ ચેપ."),
            _t("MRI restrictions (newer devices are conditional).", "MRI प्रतिबंध (नए उपकरण सशर्त)।", "MRI પ્રતિબંધ (નવા ઉપકરણો શરતી)."),
        ],
        "alternatives": _t(
            "Botox, behavioural therapy, CIC, augmentation cystoplasty, urinary diversion.",
            "बोटॉक्स, व्यवहारिक चिकित्सा, CIC, ऑगमेंटेशन सिस्टोप्लास्टी, यूरिनरी डायवर्सन।",
            "બોટોક્સ, વર્તણૂકીય ઉપચાર, CIC, ઓગમેન્ટેશન સિસ્ટોપ્લાસ્ટી, યુરિનરી ડાયવર્ઝન.",
        ),
    },
]
