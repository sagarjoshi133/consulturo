"""
ConsultUro — Patient Surgery Guides (Phase 5.3 — June 2026).

For each major urology procedure, a structured patient-facing guide:
  • preop          — what to do in the days/hours before surgery
  • day_of         — what to expect on the day of surgery
  • postop         — recovery instructions for the first 2 weeks
  • diet           — pre & post-op diet recommendations
  • recovery_milestones — week-by-week return-to-normal timeline
  • dos_donts      — quick-reference list

Each leaf is `{en, hi, gu}` so the patient app can switch language
without an extra round-trip.

Cross-references the PROCEDURES dataset via the same `key` so the
guide can be opened from any surgical-consent row, scheduled-OT
row, or prescription row that mentions a surgery.

DESIGN: this file is intentionally lean. Where a procedure shares
identical guidance with another (e.g. all endoscopic stone surgeries
have similar diet), we group them with `aliases` rather than
duplicating text.
"""
from typing import Any, Dict, List


# Universal entries reused across procedures.
_UNIVERSAL_PREOP_HYDRATION = {
    "en": "Drink 6-8 glasses of water daily for 3 days before surgery, then stop fluids 2 hours before reporting.",
    "hi": "सर्जरी से 3 दिन पहले रोज़ 6-8 गिलास पानी पिएँ, और reporting से 2 घंटे पहले पानी बंद कर दें।",
    "gu": "સર્જરી પહેલા 3 દિવસ સુધી દરરોજ 6-8 ગ્લાસ પાણી પીઓ, અને reporting પહેલા 2 કલાક પાણી બંધ કરી દો.",
}

_UNIVERSAL_FAST = {
    "en": "Solid food: stop 6 hours before surgery. Clear fluids: stop 2 hours before.",
    "hi": "ठोस आहार: सर्जरी से 6 घंटे पहले बंद। साफ़ तरल पदार्थ: 2 घंटे पहले बंद।",
    "gu": "ઘન ખોરાક: સર્જરી પહેલા 6 કલાક બંધ. સ્પષ્ટ પ્રવાહી: 2 કલાક પહેલા બંધ.",
}


GUIDES: List[Dict[str, Any]] = [
    # ─────────── TURP / HoLEP / Prostate ───────────
    {
        "key": "turp",
        "aliases": ["holep", "tuip", "bipolar_turp"],
        "name": {"en": "TURP — Prostate Surgery", "hi": "TURP — प्रोस्टेट सर्जरी", "gu": "TURP — પ્રોસ્ટેટ સર્જરી"},
        "duration_minutes": 60,
        "hospital_stay_days": 3,
        "preop": [
            {"en": "Stop blood thinners (aspirin / clopidogrel / warfarin) 5-7 days before — confirm with your cardiologist first.",
             "hi": "खून पतला करने वाली दवाएँ (aspirin / clopidogrel / warfarin) 5-7 दिन पहले बंद करें — पहले अपने cardiologist से पुष्टि करें।",
             "gu": "લોહી પાતળું કરનારી દવાઓ (aspirin / clopidogrel / warfarin) 5-7 દિવસ પહેલા બંધ કરો — પહેલા cardiologist સાથે ખાતરી કરો."},
            {"en": "Get urine culture done 2-3 days before. Any active UTI must be treated first.",
             "hi": "2-3 दिन पहले urine culture करवाएँ। कोई भी active UTI पहले treat होनी चाहिए।",
             "gu": "2-3 દિવસ પહેલા urine culture કરાવો. કોઈપણ active UTI પહેલા treat થવો જોઈએ."},
            _UNIVERSAL_PREOP_HYDRATION,
            {"en": "Shave the lower abdomen and pubic area the morning of surgery (your nurse can help).",
             "hi": "सर्जरी की सुबह पेट के निचले हिस्से और pubic area की shaving करें।",
             "gu": "સર્જરી ની સવારે પેટના નીચેના ભાગ અને pubic area ની shaving કરો."},
            _UNIVERSAL_FAST,
        ],
        "day_of": [
            {"en": "Arrive 2 hours before. Wear loose, easily-removable clothing.",
             "hi": "2 घंटे पहले पहुँचें। ढीले, आसानी से उतरने वाले कपड़े पहनें।",
             "gu": "2 કલાક પહેલા આવો. ઢીલા, સરળતાથી ઉતરનારા કપડાં પહેરો."},
            {"en": "Anaesthesia: spinal (you're awake but pain-free from waist down). Procedure: 45-60 minutes.",
             "hi": "Anaesthesia: spinal (आप जागे रहेंगे पर कमर से नीचे दर्द नहीं होगा)। Procedure: 45-60 मिनट।",
             "gu": "Anaesthesia: spinal (તમે જાગૃત રહેશો પણ કમરથી નીચે દુખાવો નહીં થાય). Procedure: 45-60 મિનિટ."},
            {"en": "A urethral catheter will stay for 2-3 days. Your urine will look pinkish initially — this is normal.",
             "hi": "Urethral catheter 2-3 दिन तक रहेगा। शुरू में पेशाब हल्का गुलाबी रंग का दिख सकता है — यह सामान्य है।",
             "gu": "Urethral catheter 2-3 દિવસ રહેશે. શરૂઆતમાં પેશાબ ગુલાબી રંગનો દેખાશે — આ સામાન્ય છે."},
        ],
        "postop": [
            {"en": "Drink 2.5-3 litres of water daily for the first 2 weeks. This flushes the surgical bed.",
             "hi": "पहले 2 हफ्ते रोज़ 2.5-3 लीटर पानी पिएँ। इससे surgical area साफ़ रहता है।",
             "gu": "પ્રથમ 2 અઠવાડિયા સુધી દરરોજ 2.5-3 લિટર પાણી પીઓ. આ surgical area સાફ રાખે છે."},
            {"en": "Avoid heavy lifting (>5 kg), cycling, and vigorous exercise for 4 weeks.",
             "hi": "4 हफ्ते तक भारी सामान (>5 kg) न उठाएँ, साइकिल न चलाएँ, और ज़ोरदार exercise न करें।",
             "gu": "4 અઠવાડિયા સુધી ભારે વસ્તુ (>5 kg) ન ઉપાડો, સાયકલ ન ચલાવો, અને ભારે કસરત ન કરો."},
            {"en": "Some burning while urinating and urgency is normal for 2-3 weeks. Take the prescribed alpha-blocker.",
             "hi": "Urinate करते समय हल्की जलन और तेज़ हाजत 2-3 हफ्ते सामान्य है। निर्धारित alpha-blocker लें।",
             "gu": "Urinate કરતી વખતે હળવી બળતરા અને જરૂરિયાત 2-3 અઠવાડિયા સામાન્ય છે. નિર્ધારિત alpha-blocker લો."},
            {"en": "Resume desk work in 1 week. Resume sexual activity after 4-6 weeks (expect retrograde ejaculation — this is normal).",
             "hi": "1 हफ्ते में डेस्क का काम शुरू कर सकते हैं। 4-6 हफ्ते बाद sexual activity शुरू करें (retrograde ejaculation सामान्य है)।",
             "gu": "1 અઠવાડિયામાં ડેસ્ક કામ શરૂ કરી શકો છો. 4-6 અઠવાડિયા પછી sexual activity શરૂ કરો (retrograde ejaculation સામાન્ય છે)."},
        ],
        "diet": {
            "preop": [
                {"en": "3 days before: high-fibre diet (oats, fruits, salads) to avoid constipation post-op.",
                 "hi": "3 दिन पहले: high-fibre आहार (oats, फल, salad) ताकि सर्जरी के बाद कब्ज़ न हो।",
                 "gu": "3 દિવસ પહેલા: high-fibre આહાર (oats, ફળ, salad) જેથી સર્જરી પછી કબજિયાત ન થાય."},
                {"en": "Avoid alcohol for at least 48 hours before surgery.",
                 "hi": "सर्जरी से कम-से-कम 48 घंटे पहले शराब बंद करें।",
                 "gu": "સર્જરી પહેલા ઓછામાં ઓછા 48 કલાક દારૂ બંધ કરો."},
            ],
            "postop": [
                {"en": "Day 1-3: soft foods — khichdi, daliya, soups, curd. Avoid spicy/oily food.",
                 "hi": "दिन 1-3: नरम भोजन — खिचड़ी, दलिया, सूप, दही। तीखा/तला भोजन न लें।",
                 "gu": "દિવસ 1-3: નરમ ખોરાક — ખીચડી, દળિયા, સૂપ, દહીં. તીખું/તળેલું ન ખાવ."},
                {"en": "Avoid caffeine (coffee, strong tea) and carbonated drinks for 2 weeks — they irritate the bladder.",
                 "hi": "2 हफ्ते caffeine (coffee, मजबूत चाय) और cold drinks न लें — ये bladder में जलन पैदा करते हैं।",
                 "gu": "2 અઠવાડિયા caffeine (coffee, મજબૂત ચા) અને cold drinks ન લો — તે bladder ને બળતરા કરે છે."},
                {"en": "Include daily curd or buttermilk to maintain healthy gut flora while on antibiotics.",
                 "hi": "Antibiotics के दौरान रोज़ दही या छाछ लें ताकि gut bacteria स्वस्थ रहें।",
                 "gu": "Antibiotics દરમિયાન દરરોજ દહીં અથવા છાશ લો જેથી gut bacteria સ્વસ્થ રહે."},
            ],
        },
        "recovery_milestones": [
            {"day": 1,  "en": "Catheter removed in 2-3 days. Start walking around the room.", "hi": "2-3 दिन में catheter निकलेगा। कमरे में चलना शुरू करें।", "gu": "2-3 દિવસમાં catheter નીકળશે. ઓરડામાં ચાલવાનું શરૂ કરો."},
            {"day": 7,  "en": "Resume desk work. Light walking 20-30 min daily.", "hi": "Desk work शुरू करें। रोज़ 20-30 मिनट हल्की walk करें।", "gu": "Desk work શરૂ કરો. દરરોજ 20-30 મિનિટ હળવી walk કરો."},
            {"day": 14, "en": "Most patients pass urine comfortably. Follow-up visit + urine test.", "hi": "ज्यादातर मरीज़ अच्छे से पेशाब करने लगते हैं। Follow-up + urine test।", "gu": "મોટાભાગના દર્દીઓ આરામથી પેશાબ કરી શકે છે. Follow-up + urine test."},
            {"day": 30, "en": "Return to all normal activities except heavy exercise.", "hi": "भारी exercise को छोड़कर सभी सामान्य काम शुरू करें।", "gu": "ભારે કસરત સિવાય બધી સામાન્ય પ્રવૃત્તિઓ શરૂ કરો."},
            {"day": 42, "en": "Resume sexual activity, gym, swimming. Final follow-up.", "hi": "Sexual activity, gym, swimming फिर शुरू कर सकते हैं। आखिरी follow-up।", "gu": "Sexual activity, gym, swimming ફરી શરૂ કરી શકો છો. છેલ્લો follow-up."},
        ],
        "dos_donts": {
            "dos": [
                {"en": "Drink 2.5-3 L water/day.", "hi": "रोज़ 2.5-3 लीटर पानी पिएँ।", "gu": "દરરોજ 2.5-3 લિટર પાણી પીઓ."},
                {"en": "Take all prescribed medicines on time.", "hi": "सभी दवाएँ समय पर लें।", "gu": "બધી દવાઓ સમયસર લો."},
                {"en": "Walk 20-30 min daily from day 3.", "hi": "दिन 3 से रोज़ 20-30 मिनट walk करें।", "gu": "દિવસ 3 થી દરરોજ 20-30 મિનિટ walk કરો."},
            ],
            "donts": [
                {"en": "Don't lift >5 kg for 4 weeks.", "hi": "4 हफ्ते 5 kg से ज़्यादा वजन न उठाएँ।", "gu": "4 અઠવાડિયા 5 kg થી વધુ વજન ન ઉપાડો."},
                {"en": "Don't ride a bicycle/bike for 4 weeks.", "hi": "4 हफ्ते साइकिल/बाइक न चलाएँ।", "gu": "4 અઠવાડિયા સાયકલ/બાઇક ન ચલાવો."},
                {"en": "Don't ignore fever >100°F or heavy bleeding — call us immediately.", "hi": "100°F से ज़्यादा बुखार या ज़्यादा खून आने को नज़रअंदाज़ न करें — तुरंत कॉल करें।", "gu": "100°F થી વધુ તાવ અથવા વધુ રક્તસ્રાવ ને અવગણશો નહીં — તરત જ કૉલ કરો."},
            ],
        },
    },

    # ─────────── PCNL ───────────
    {
        "key": "pcnl",
        "aliases": ["mini_pcnl", "micro_pcnl"],
        "name": {"en": "PCNL — Kidney Stone Surgery", "hi": "PCNL — गुर्दे की पथरी की सर्जरी", "gu": "PCNL — કિડની પથરી ની સર્જરી"},
        "duration_minutes": 90,
        "hospital_stay_days": 3,
        "preop": [
            {"en": "Get a CT KUB (plain) within 2 weeks of surgery to confirm stone position.",
             "hi": "सर्जरी से 2 हफ्ते के अंदर CT KUB (plain) करवाएँ ताकि पथरी की position confirm हो।",
             "gu": "સર્જરી પહેલા 2 અઠવાડિયામાં CT KUB (plain) કરાવો જેથી પથરી ની position confirm થાય."},
            {"en": "Urine culture must be sterile. Any infection → treat first.",
             "hi": "Urine culture sterile होना चाहिए। कोई infection → पहले treat करें।",
             "gu": "Urine culture sterile હોવો જોઈએ. કોઈ infection → પહેલા treat કરો."},
            {"en": "Stop blood thinners 5-7 days before (confirm with your physician).",
             "hi": "खून पतला करने वाली दवाएँ 5-7 दिन पहले बंद करें।",
             "gu": "લોહી પાતળું કરનારી દવાઓ 5-7 દિવસ પહેલા બંધ કરો."},
            _UNIVERSAL_FAST,
        ],
        "day_of": [
            {"en": "Anaesthesia: general (GA). You'll be asleep throughout.",
             "hi": "Anaesthesia: general (GA)। आप पूरे time सोए रहेंगे।",
             "gu": "Anaesthesia: general (GA). તમે સંપૂર્ણ time સૂતેલા રહેશો."},
            {"en": "A small ~1cm puncture is made in the back to access the kidney. No large cuts.",
             "hi": "गुर्दे तक पहुँचने के लिए पीठ में ~1 cm का छोटा छेद किया जाता है। कोई बड़ा कट नहीं।",
             "gu": "કિડની સુધી પહોંચવા માટે પીઠમાં ~1 cm નો નાનો છિદ્ર કરવામાં આવે છે. કોઈ મોટો કટ નહીં."},
            {"en": "A nephrostomy tube (drain) + urethral catheter + DJ stent stay for 1-3 days.",
             "hi": "Nephrostomy tube (drain) + urethral catheter + DJ stent 1-3 दिन तक रहेंगे।",
             "gu": "Nephrostomy tube (drain) + urethral catheter + DJ stent 1-3 દિવસ સુધી રહેશે."},
        ],
        "postop": [
            {"en": "Drink 3-3.5 litres of water daily for 4 weeks to prevent new stones.",
             "hi": "नई पथरी रोकने के लिए 4 हफ्ते रोज़ 3-3.5 लीटर पानी पिएँ।",
             "gu": "નવી પથરી અટકાવવા 4 અઠવાડિયા દરરોજ 3-3.5 લિટર પાણી પીઓ."},
            {"en": "Slight pink colour in urine for 1 week is normal. Heavy red bleeding → call us.",
             "hi": "1 हफ्ते तक पेशाब में हल्का गुलाबी रंग सामान्य है। ज़्यादा लाल खून आए → कॉल करें।",
             "gu": "1 અઠવાડિયા સુધી પેશાબમાં હળવો ગુલાબી રંગ સામાન્ય છે. વધુ લાલ રક્ત આવે → કૉલ કરો."},
            {"en": "DJ stent removed in OPD after 2-4 weeks — short 5-min procedure.",
             "hi": "DJ stent 2-4 हफ्ते बाद OPD में निकाला जाएगा — 5 मिनट का procedure।",
             "gu": "DJ stent 2-4 અઠવાડિયા પછી OPD માં દૂર કરવામાં આવશે — 5 મિનિટ નો procedure."},
            {"en": "Send any passed stone fragments for analysis — helps prevent recurrence.",
             "hi": "निकले हुए पथरी के टुकड़े analysis के लिए भेजें — नई पथरी रोकने में मदद मिलेगी।",
             "gu": "નીકળેલા પથરી ના ટુકડા analysis માટે મોકલો — નવી પથરી અટકાવવામાં મદદ થશે."},
        ],
        "diet": {
            "preop": [
                {"en": "Reduce salt + animal protein 1 week before. Avoid spinach, beetroot (oxalate-rich).",
                 "hi": "1 हफ्ते पहले नमक और जानवरी protein कम करें। पालक, चुकंदर न लें (oxalate ज़्यादा)।",
                 "gu": "1 અઠવાડિયા પહેલા મીઠું અને પ્રાણીજ protein ઓછું કરો. પાલક, બીટ ન લો (oxalate વધારે)."},
            ],
            "postop": [
                {"en": "Lemon water (2-3 glasses/day) — citrate helps dissolve calcium-oxalate stones.",
                 "hi": "नींबू पानी (दिन में 2-3 गिलास) — citrate calcium oxalate पथरी घोलने में मदद करता है।",
                 "gu": "લીંબુ પાણી (દિવસમાં 2-3 ગ્લાસ) — citrate calcium oxalate પથરી ઓગાળવામાં મદદ કરે છે."},
                {"en": "Restrict: spinach, beetroot, nuts, chocolate, strong tea (high oxalate).",
                 "hi": "मना: पालक, चुकंदर, मेवे, chocolate, गहरी चाय (oxalate ज़्यादा)।",
                 "gu": "મનાઈ: પાલક, બીટ, સૂકા મેવા, chocolate, ગાઢી ચા (oxalate વધારે)."},
                {"en": "Increase: cucumber, watermelon, ash gourd, coconut water — natural diuretics.",
                 "hi": "बढ़ाएँ: खीरा, तरबूज़, पेठा, नारियल पानी — natural diuretics।",
                 "gu": "વધારો: કાકડી, તરબૂચ, કોળું, નારિયેળ પાણી — natural diuretics."},
                {"en": "Salt: < 5 g/day. Animal protein: < 100 g/day (1 small portion).",
                 "hi": "नमक: <5 g रोज़। जानवरी protein: <100 g रोज़ (1 छोटा हिस्सा)।",
                 "gu": "મીઠું: <5 g દરરોજ. પ્રાણીજ protein: <100 g દરરોજ (1 નાનો ભાગ)."},
            ],
        },
        "recovery_milestones": [
            {"day": 1, "en": "Nephrostomy tube removed. Walking encouraged.", "hi": "Nephrostomy tube निकल जाएगा। चलना शुरू करें।", "gu": "Nephrostomy tube દૂર થશે. ચાલવાનું શરૂ કરો."},
            {"day": 3, "en": "Discharge. Catheter often removed before discharge.", "hi": "Discharge। Catheter आम तौर पर discharge से पहले निकलता है।", "gu": "Discharge. Catheter સામાન્ય રીતે discharge પહેલા નીકળે છે."},
            {"day": 7, "en": "Light desk work OK. Continue high water intake.", "hi": "Desk work शुरू कर सकते हैं। पानी ज़्यादा पीते रहें।", "gu": "Desk work શરૂ કરી શકો છો. પાણી વધારે પીતા રહો."},
            {"day": 21, "en": "DJ stent removal in OPD. Stone analysis results discussed.", "hi": "OPD में DJ stent निकाला जाएगा। पथरी की analysis report पर discussion।", "gu": "OPD માં DJ stent દૂર કરવામાં આવશે. પથરી analysis report પર ચર્ચા."},
            {"day": 42, "en": "Full return to work, gym, travel. Repeat ultrasound.", "hi": "काम, gym, travel पूरी तरह शुरू। दुबारा ultrasound।", "gu": "કામ, gym, travel સંપૂર્ણ રીતે શરૂ. ફરી ultrasound."},
        ],
        "dos_donts": {
            "dos": [
                {"en": "Drink 3+ litres water daily for 4 weeks.", "hi": "4 हफ्ते रोज़ 3+ लीटर पानी पिएँ।", "gu": "4 અઠવાડિયા દરરોજ 3+ લિટર પાણી પીઓ."},
                {"en": "Add lemon to your water 2-3 times/day.", "hi": "रोज़ 2-3 बार पानी में नींबू मिलाएँ।", "gu": "દરરોજ 2-3 વાર પાણીમાં લીંબુ ઉમેરો."},
                {"en": "Send any passed stone fragment for chemical analysis.", "hi": "निकली पथरी के टुकड़े analysis के लिए भेजें।", "gu": "નીકળેલા પથરી ના ટુકડા analysis માટે મોકલો."},
            ],
            "donts": [
                {"en": "Don't skip the DJ stent removal appointment.", "hi": "DJ stent निकलवाने का appointment न भूलें।", "gu": "DJ stent દૂર કરવાનું appointment ન ભૂલો."},
                {"en": "Don't ignore high-grade fever — it could mean infection.", "hi": "तेज़ बुखार को नज़रअंदाज़ न करें — infection हो सकता है।", "gu": "ઊંચા તાવને અવગણશો નહીં — infection થઈ શકે છે."},
                {"en": "Avoid high-oxalate foods: spinach, beetroot, peanuts.", "hi": "High-oxalate foods न लें: पालक, चुकंदर, मूँगफली।", "gu": "High-oxalate foods ન લો: પાલક, બીટ, મગફળી."},
            ],
        },
    },

    # ─────────── URSL ───────────
    {
        "key": "ursl",
        "aliases": ["urs", "rirs", "fursl"],
        "name": {"en": "URSL — Ureteric Stone Surgery", "hi": "URSL — Ureter की पथरी सर्जरी", "gu": "URSL — Ureter ની પથરી સર્જરી"},
        "duration_minutes": 45,
        "hospital_stay_days": 1,
        "preop": [
            {"en": "Get urine culture done. Confirm stone position via CT or X-ray KUB.",
             "hi": "Urine culture करवाएँ। CT या X-ray KUB से पथरी की position confirm करें।",
             "gu": "Urine culture કરાવો. CT અથવા X-ray KUB થી પથરી ની position confirm કરો."},
            _UNIVERSAL_FAST,
            {"en": "Stop blood thinners 5-7 days before (confirm with your physician).",
             "hi": "खून पतला करने वाली दवाएँ 5-7 दिन पहले बंद करें।",
             "gu": "લોહી પાતળું કરનારી દવાઓ 5-7 દિવસ પહેલા બંધ કરો."},
        ],
        "day_of": [
            {"en": "Anaesthesia: spinal or short GA. Procedure: 30-45 minutes.",
             "hi": "Anaesthesia: spinal या short GA। Procedure: 30-45 मिनट।",
             "gu": "Anaesthesia: spinal અથવા short GA. Procedure: 30-45 મિનિટ."},
            {"en": "No external cuts — surgeon goes up the urethra with a thin scope.",
             "hi": "कोई बाहर का कट नहीं — surgeon urethra से एक पतला scope ऊपर ले जाते हैं।",
             "gu": "કોઈ બાહ્ય કટ નહીં — surgeon urethra થી પાતળું scope ઉપર લઈ જાય છે."},
            {"en": "A DJ stent is placed and stays for 1-2 weeks. Mild bladder irritation is normal.",
             "hi": "DJ stent डाला जाता है, 1-2 हफ्ते रहता है। हल्की bladder irritation सामान्य है।",
             "gu": "DJ stent મુકાય છે, 1-2 અઠવાડિયા રહે છે. હળવી bladder irritation સામાન્ય છે."},
        ],
        "postop": [
            {"en": "Same-day or next-day discharge. Resume desk work in 2-3 days.",
             "hi": "उसी दिन या अगले दिन discharge। 2-3 दिन में desk work शुरू कर सकते हैं।",
             "gu": "તે જ દિવસે અથવા બીજા દિવસે discharge. 2-3 દિવસમાં desk work શરૂ કરી શકો છો."},
            {"en": "Stent causes mild urgency and pink urine — drink lots of water to flush.",
             "hi": "Stent से हल्की urgency और गुलाबी पेशाब हो सकता है — खूब पानी पिएँ।",
             "gu": "Stent થી હળવી urgency અને ગુલાબી પેશાબ થઈ શકે — ખૂબ પાણી પીઓ."},
            {"en": "Stent removal in OPD after 1-2 weeks (2-3 min procedure).",
             "hi": "OPD में 1-2 हफ्ते बाद stent निकलेगा (2-3 मिनट का काम)।",
             "gu": "OPD માં 1-2 અઠવાડિયા પછી stent નીકળશે (2-3 મિનિટ નું કામ)."},
        ],
        "diet": {
            "preop": [
                {"en": "Light dinner the night before. Stay well-hydrated.",
                 "hi": "एक रात पहले हल्का dinner लें। पानी अच्छे से पिएँ।",
                 "gu": "આગલી રાત્રે હળવું dinner લો. પાણી સારી રીતે પીઓ."},
            ],
            "postop": [
                {"en": "Drink 2.5-3 litres water daily until stent is out.",
                 "hi": "Stent निकलने तक रोज़ 2.5-3 लीटर पानी पिएँ।",
                 "gu": "Stent નીકળે ત્યાં સુધી દરરોજ 2.5-3 લિટર પાણી પીઓ."},
                {"en": "Lemon water + coconut water are excellent. Avoid heavy oxalate foods.",
                 "hi": "नींबू पानी + नारियल पानी बहुत अच्छे हैं। ज़्यादा oxalate वाले foods न लें।",
                 "gu": "લીંબુ પાણી + નારિયેળ પાણી ઉત્તમ છે. વધારે oxalate ખોરાક ન લો."},
                {"en": "Same diet rules as PCNL for stone prevention.",
                 "hi": "पथरी रोकने के लिए वही diet rules जो PCNL के लिए हैं।",
                 "gu": "પથરી અટકાવવા માટે એ જ diet rules જે PCNL માટે છે."},
            ],
        },
        "recovery_milestones": [
            {"day": 1, "en": "Discharge same/next day.", "hi": "उसी / अगले दिन discharge।", "gu": "તે જ / બીજા દિવસે discharge."},
            {"day": 3, "en": "Resume desk work and light activity.", "hi": "Desk work + हल्की activity शुरू करें।", "gu": "Desk work + હળવી activity શરૂ કરો."},
            {"day": 14, "en": "DJ stent removed in OPD.", "hi": "OPD में DJ stent निकलेगा।", "gu": "OPD માં DJ stent નીકળશે."},
            {"day": 28, "en": "Repeat ultrasound + stone-analysis discussion.", "hi": "दुबारा ultrasound + पथरी analysis पर बातचीत।", "gu": "ફરી ultrasound + પથરી analysis ની ચર્ચા."},
        ],
        "dos_donts": {
            "dos": [
                {"en": "Hydrate heavily — water + lemon.", "hi": "खूब पानी + नींबू पिएँ।", "gu": "ખૂબ પાણી + લીંબુ પીઓ."},
                {"en": "Walk daily; light activity is fine.", "hi": "रोज़ चलें; हल्की activity ठीक है।", "gu": "દરરોજ ચાલો; હળવી activity ઠીક છે."},
            ],
            "donts": [
                {"en": "Don't miss the stent removal date.", "hi": "Stent निकलवाने की date न भूलें।", "gu": "Stent દૂર કરવાની date ન ભૂલો."},
                {"en": "Don't ignore fever / severe flank pain.", "hi": "बुखार / तेज़ कमर दर्द को नज़रअंदाज़ न करें।", "gu": "તાવ / તીવ્ર કમર દુખાવો અવગણશો નહીં."},
            ],
        },
    },
]


def get_guide(key: str) -> Dict[str, Any]:
    """Return the guide for `key` or any of its aliases. None if not found."""
    k = (key or "").strip().lower()
    for g in GUIDES:
        if g["key"] == k:
            return g
        if k in (g.get("aliases") or []):
            return g
    return None
