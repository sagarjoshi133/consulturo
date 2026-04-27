"""Trilingual doctor profile strings (About page).

Only the prose-heavy fields (title, tagline, short_bio, personal_statement,
highlights, stats labels, past_experience roles, availability phrases) are
localized here. Technical/proper-noun fields (qualifications, memberships,
clinic names, service_categories) stay in English across all locales.
"""

from typing import Dict, Any, List


_EN = {
    "title": "Consultant Urologist, Laparoscopic & Transplant Surgeon",
    "tagline": "Healing with skill, compassion, and trust.",
    "short_bio": (
        "Dr. Sagar Joshi is a skilled and compassionate Urologist dedicated to "
        "patient-centred care in Vadodara, Gujarat. With 11+ years of surgical "
        "experience and super-speciality training from Gleneagles Global Hospital "
        "(Parel, Mumbai), he focuses on advanced minimally invasive techniques — "
        "laser urology, laparoscopy, robotic surgery and kidney transplantation. "
        "His practice is built around three pillars: clear explanation, evidence-based "
        "treatment and quicker recovery with minimal discomfort."
    ),
    "personal_statement": (
        "I am dedicated to simplifying what is often a very complicated and confusing "
        "area of healthcare. My goal is to offer honest counsel, modern surgical "
        "options and a treatment pathway you fully understand before we begin."
    ),
    "highlights": [
        "Super-specialty DrNB Urology training at Gleneagles Global Hospital, Parel, Mumbai",
        "Expertise in kidney transplant & advanced laparoscopic urology",
        "Laser stone surgery (RIRS / ESWL / PCNL) and HoLEP laser prostate surgery",
        "Evidence-based andrology — ED, male infertility and Peyronie's disease",
        "Uro-oncology — kidney, bladder, prostate and testicular cancer management",
    ],
    "stats_labels": {
        "years_experience": "Years of experience",
        "surgeries_performed": "Surgeries performed",
        "kidney_transplants": "Kidney transplants",
        "consultations": "Consultations",
    },
    "past_roles": {
        "Resident Doctor — General Surgery": "Resident Doctor — General Surgery",
        "Senior Resident — General Surgery": "Senior Resident — General Surgery",
        "Assistant Professor — General Surgery": "Assistant Professor — General Surgery",
        "Urology Resident (DrNB)": "Urology Resident (DrNB)",
    },
    "availability_phrases": {
        "mon_sat": "10:00 AM – 1:00 PM  &  5:00 PM – 8:00 PM",
        "sunday": "Emergency only",
    },
}

_HI = {
    "title": "कंसल्टेंट यूरोलॉजिस्ट · लेप्रोस्कोपिक एवं ट्रांसप्लांट सर्जन",
    "tagline": "कौशल, करुणा और विश्वास के साथ उपचार।",
    "short_bio": (
        "डॉ. सागर जोशी वडोदरा, गुजरात में एक कुशल एवं सहानुभूतिपूर्ण यूरोलॉजिस्ट हैं। "
        "ग्लेनीगल्स ग्लोबल हॉस्पिटल (परेल, मुंबई) से सुपर-स्पेशियलिटी प्रशिक्षण और 11+ वर्षों के "
        "सर्जिकल अनुभव के साथ, वे उन्नत न्यूनतम इनवेसिव तकनीकों — लेज़र यूरोलॉजी, लेप्रोस्कोपी, "
        "रोबोटिक सर्जरी और किडनी ट्रांसप्लांट — पर केंद्रित हैं। उनका अभ्यास तीन स्तंभों पर "
        "आधारित है: स्पष्ट व्याख्या, साक्ष्य-आधारित उपचार और न्यूनतम असुविधा के साथ शीघ्र स्वास्थ्य-लाभ।"
    ),
    "personal_statement": (
        "मैं स्वास्थ्य-सेवा के इस अक्सर जटिल और भ्रामक क्षेत्र को सरल बनाने के लिए समर्पित हूँ। "
        "मेरा लक्ष्य है ईमानदार परामर्श, आधुनिक सर्जिकल विकल्प और एक ऐसी उपचार-यात्रा प्रदान करना "
        "जिसे आरंभ करने से पहले आप पूरी तरह समझें।"
    ),
    "highlights": [
        "ग्लेनीगल्स ग्लोबल हॉस्पिटल, परेल, मुंबई में DrNB यूरोलॉजी का सुपर-स्पेशियलिटी प्रशिक्षण",
        "किडनी ट्रांसप्लांट एवं उन्नत लेप्रोस्कोपिक यूरोलॉजी में विशेषज्ञता",
        "लेज़र स्टोन सर्जरी (RIRS / ESWL / PCNL) तथा HoLEP प्रोस्टेट लेज़र सर्जरी",
        "साक्ष्य-आधारित एंड्रोलॉजी — ED, पुरुष बाँझपन और पेरोनी रोग",
        "यूरो-ऑन्कोलॉजी — किडनी, मूत्राशय, प्रोस्टेट एवं वृषण कैंसर का प्रबंधन",
    ],
    "stats_labels": {
        "years_experience": "वर्षों का अनुभव",
        "surgeries_performed": "की गई सर्जरियाँ",
        "kidney_transplants": "किडनी ट्रांसप्लांट",
        "consultations": "परामर्श",
    },
    "past_roles": {
        "Resident Doctor — General Surgery": "रेज़िडेंट डॉक्टर — जनरल सर्जरी",
        "Senior Resident — General Surgery": "सीनियर रेज़िडेंट — जनरल सर्जरी",
        "Assistant Professor — General Surgery": "असिस्टेंट प्रोफ़ेसर — जनरल सर्जरी",
        "Urology Resident (DrNB)": "यूरोलॉजी रेज़िडेंट (DrNB)",
    },
    "availability_phrases": {
        "mon_sat": "सुबह 10:00 – दोपहर 1:00  एवं  शाम 5:00 – 8:00",
        "sunday": "केवल आपात",
    },
}

_GU = {
    "title": "કન્સલ્ટન્ટ યુરોલોજિસ્ટ · લેપ્રોસ્કોપિક અને ટ્રાન્સપ્લાન્ટ સર્જન",
    "tagline": "કૌશલ્ય, કરુણા અને વિશ્વાસ સાથે સારવાર.",
    "short_bio": (
        "ડૉ. સાગર જોશી વડોદરા, ગુજરાતમાં કુશળ અને સહાનુભૂતિસભર યુરોલોજિસ્ટ છે. "
        "ગ્લેનીગલ્સ ગ્લોબલ હોસ્પિટલ (પરેલ, મુંબઈ)માંથી સુપર-સ્પેશિયાલિટી તાલીમ અને 11+ વર્ષના "
        "સર્જિકલ અનુભવ સાથે, તેઓ અદ્યતન ન્યૂનતમ આક્રમક તકનીકો — લેસર યુરોલોજી, લેપ્રોસ્કોપી, "
        "રોબોટિક સર્જરી અને કિડની ટ્રાન્સપ્લાન્ટ — પર ધ્યાન કેન્દ્રિત કરે છે. તેમની પ્રેક્ટિસ ત્રણ "
        "સ્તંભો પર આધારિત છે: સ્પષ્ટ સમજૂતી, પુરાવા-આધારિત સારવાર અને ઝડપી પુનઃપ્રાપ્તિ ન્યૂનતમ "
        "તકલીફ સાથે."
    ),
    "personal_statement": (
        "હું આરોગ્ય-સેવાના આ ઘણીવાર જટિલ અને મૂંઝવનારા ક્ષેત્રને સરળ બનાવવા માટે સમર્પિત છું. "
        "મારો ધ્યેય છે પ્રામાણિક સલાહ, આધુનિક સર્જિકલ વિકલ્પો અને એવો સારવાર માર્ગ આપવો "
        "જે શરૂ કરતાં પહેલાં તમે પૂરેપૂરો સમજો."
    ),
    "highlights": [
        "ગ્લેનીગલ્સ ગ્લોબલ હોસ્પિટલ, પરેલ, મુંબઈમાં DrNB યુરોલોજી સુપર-સ્પેશિયાલિટી તાલીમ",
        "કિડની ટ્રાન્સપ્લાન્ટ અને અદ્યતન લેપ્રોસ્કોપિક યુરોલોજીમાં નિપુણતા",
        "લેસર સ્ટોન સર્જરી (RIRS / ESWL / PCNL) અને HoLEP પ્રોસ્ટેટ લેસર સર્જરી",
        "પુરાવા-આધારિત એન્ડ્રોલોજી — ED, પુરુષ વંધ્યત્વ અને પેરોની રોગ",
        "યુરો-ઓન્કોલોજી — કિડની, મૂત્રાશય, પ્રોસ્ટેટ અને વૃષણ કેન્સરનું વ્યવસ્થાપન",
    ],
    "stats_labels": {
        "years_experience": "વર્ષોનો અનુભવ",
        "surgeries_performed": "કરેલી સર્જરીઓ",
        "kidney_transplants": "કિડની ટ્રાન્સપ્લાન્ટ",
        "consultations": "કન્સલ્ટેશન્સ",
    },
    "past_roles": {
        "Resident Doctor — General Surgery": "રેસિડેન્ટ ડૉક્ટર — જનરલ સર્જરી",
        "Senior Resident — General Surgery": "સીનિયર રેસિડેન્ટ — જનરલ સર્જરી",
        "Assistant Professor — General Surgery": "આસિસ્ટન્ટ પ્રોફેસર — જનરલ સર્જરી",
        "Urology Resident (DrNB)": "યુરોલોજી રેસિડેન્ટ (DrNB)",
    },
    "availability_phrases": {
        "mon_sat": "સવારે 10:00 – બપોરે 1:00  અને  સાંજે 5:00 – 8:00",
        "sunday": "માત્ર તાત્કાલિક",
    },
}


_BY_LANG: Dict[str, Dict[str, Any]] = {"en": _EN, "hi": _HI, "gu": _GU}


def get_locale(lang: str) -> Dict[str, Any]:
    """Return the localized doctor strings dict. Falls back to English."""
    return _BY_LANG.get(lang or "en", _EN)


def localize_stats(stats: List[Dict[str, Any]], lang: str) -> List[Dict[str, Any]]:
    """Replace English stat labels with localized ones (keys are order-based)."""
    labels = get_locale(lang)["stats_labels"]
    order = ["years_experience", "surgeries_performed", "kidney_transplants", "consultations"]
    out = []
    for i, s in enumerate(stats):
        lbl_key = order[i] if i < len(order) else None
        out.append({
            **s,
            "label": labels.get(lbl_key, s.get("label", "")) if lbl_key else s.get("label", ""),
        })
    return out


def localize_past_experience(past: List[Dict[str, Any]], lang: str) -> List[Dict[str, Any]]:
    """Translate the `role` field. Leave `place` (proper nouns) untouched."""
    mapping = get_locale(lang)["past_roles"]
    return [{**p, "role": mapping.get(p.get("role", ""), p.get("role", ""))} for p in past]
