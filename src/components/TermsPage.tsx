import { useState } from "react";
import { Languages } from "lucide-react";
import { motion } from "motion/react";
import { acceptTerms } from "../lib/backend";
const HANDLE = "@skymobileandelectronics";
// Shown before the wheel. Reviewed Tamil is recommended before wide use.
const TEXT = {
  en: {
    title: "Terms & Conditions",
    intro: "Please read and accept these terms to take part in the SKY Dream Diwali offer.",
    terms: [
      `Instagram: share your Diwali poster as a post and as a story, follow ${HANDLE}, add us as a collaborator, and share it with at least 3 people.`,
      "WhatsApp: post your poster as your status and share it in at least 3 groups and with your friends.",
      `iPhone 15 contest: customers who purchase above ₹10,000 can record a video review of their product and post it as an Instagram Reel with ${HANDLE} as a collaborator. The Reel with the highest views, likes and comments has a chance to win an iPhone 15.`,
      "Only organic views, likes and comments are accepted. Paid, bought or automated engagement will lead to disqualification.",
      "The spin wheel gift is final. It cannot be exchanged for another product or for cash.",
    ],
    accept: "I accept the terms and conditions",
    video: "I will make a product video review",
    instagram: "Your Instagram ID",
    placeholder: "e.g. @yourname",
    submit: "Continue",
    toggle: "தமிழில் படிக்க",
    needTerms: "Please accept the terms and conditions.",
    needId: "Enter your Instagram ID.",
  },
  ta: {
    title: "விதிமுறைகள் மற்றும் நிபந்தனைகள்",
    intro: "SKY Dream Diwali சலுகையில் பங்கேற்க, இந்த விதிமுறைகளைப் படித்து ஏற்றுக்கொள்ளவும்.",
    terms: [
      `Instagram: உங்கள் தீபாவளி போஸ்டரை post ஆகவும் story ஆகவும் பகிரவும், ${HANDLE} பக்கத்தை follow செய்யவும், எங்களை collaborator ஆகச் சேர்க்கவும், குறைந்தது 3 பேருடன் பகிரவும்.`,
      "WhatsApp: உங்கள் போஸ்டரை status ஆக வைத்து, குறைந்தது 3 குழுக்களிலும் உங்கள் நண்பர்களுடனும் பகிரவும்.",
      `iPhone 15 போட்டி: ₹10,000-க்கு மேல் வாங்கும் வாடிக்கையாளர்கள் தங்கள் பொருளின் வீடியோ விமர்சனத்தை ${HANDLE} உடன் collaborator ஆக Instagram Reel-ஆக பதிவிடலாம். அதிக views, likes மற்றும் comments பெறும் Reel-க்கு iPhone 15 வெல்லும் வாய்ப்பு உண்டு.`,
      "இயல்பாகக் கிடைக்கும் views, likes மற்றும் comments மட்டுமே ஏற்றுக்கொள்ளப்படும். பணம் கொடுத்து வாங்கிய அல்லது தானியங்கி ஈடுபாடு தகுதிநீக்கத்திற்கு வழிவகுக்கும்.",
      "சுழற்சி சக்கரத்தில் கிடைக்கும் பரிசு இறுதியானது. அதை வேறு பொருளாகவோ பணமாகவோ மாற்ற இயலாது.",
    ],
    accept: "விதிமுறைகள் மற்றும் நிபந்தனைகளை ஏற்றுக்கொள்கிறேன்",
    video: "நான் பொருளின் வீடியோ விமர்சனம் செய்வேன்",
    instagram: "உங்கள் Instagram ID",
    placeholder: "எ.கா. @yourname",
    submit: "தொடரவும்",
    toggle: "Read in English",
    needTerms: "விதிமுறைகளை ஏற்றுக்கொள்ளவும்.",
    needId: "உங்கள் Instagram ID-ஐ உள்ளிடவும்.",
  },
};
export function TermsPage({
  token,
  onDone,
}: {
  token: string;
  /** Called with whether they pledged a video review. */
  onDone: (videoReview: boolean) => void;
}) {
  const [lang, setLang] = useState<"en" | "ta">("en");
  const [accepted, setAccepted] = useState(false);
  const [video, setVideo] = useState(false);
  const [instagram, setInstagram] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = TEXT[lang];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!accepted) return setError(t.needTerms);
    if (video && !instagram.trim()) return setError(t.needId);
    setBusy(true);
    setError("");
    try {
      await acceptTerms(token, video, instagram.trim());
      onDone(video);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <motion.form
      className="phone-card manager-card terms-card"
      onSubmit={(e) => void submit(e)}
      initial={{ opacity: 0, scale: 0.92, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      lang={lang}
    >
      <button
        type="button"
        className="terms-lang"
        onClick={() => setLang(lang === "en" ? "ta" : "en")}
      >
        <Languages size={16} aria-hidden="true" /> {t.toggle}
      </button>
      <h1 className="phone-title">{t.title}</h1>
      <p>{t.intro}</p>
      <ol className="terms-list">
        {t.terms.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <label className="terms-check">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => {
            setAccepted(e.target.checked);
            setError("");
          }}
        />
        {t.accept}
      </label>
      <label className="terms-check">
        <input
          type="checkbox"
          checked={video}
          onChange={(e) => {
            setVideo(e.target.checked);
            setError("");
          }}
        />
        {t.video}
      </label>
      {video && (
        <>
          <label htmlFor="terms-instagram">{t.instagram}</label>
          <input
            id="terms-instagram"
            className="manager-input"
            autoCapitalize="none"
            autoComplete="off"
            maxLength={31}
            placeholder={t.placeholder}
            value={instagram}
            onChange={(e) =>
              setInstagram(e.target.value.replace(/[^@A-Za-z0-9._]/g, ""))
            }
          />
        </>
      )}
      <p className="phone-help phone-help-error" role="alert">
        {error}
      </p>
      <button className="spin-button phone-continue" disabled={busy || !accepted}>
        {busy ? "…" : t.submit}
      </button>
    </motion.form>
  );
}
