import { useEffect, useState } from "react";

const EMOJIS = ["🚧", "🏗️", "🔨", "🛠️", "⚡", "📐", "🧱", "🚜"];
const WORDS = [
  "Sedang dalam tahap pengembangan",
  "Segera hadir",
  "Tim kami sedang bekerja keras",
  "Pantau terus update selanjutnya",
];

export default function ComingSoon() {
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [wordIdx, setWordIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const emojiInterval = setInterval(() => {
      setEmoji((prev) => {
        const currentIdx = EMOJIS.indexOf(prev);
        return EMOJIS[(currentIdx + 1) % EMOJIS.length];
      });
    }, 800);

    const wordInterval = setInterval(() => {
      setWordIdx((prev) => (prev + 1) % WORDS.length);
    }, 3000);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) return 0;
        return prev + Math.floor(Math.random() * 8) + 2;
      });
    }, 500);

    return () => {
      clearInterval(emojiInterval);
      clearInterval(wordInterval);
      clearInterval(progressInterval);
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "2rem",
        gap: "1.5rem",
      }}
    >
      <div
        style={{
          fontSize: "5rem",
          lineHeight: 1,
          animation: "bounce 1s infinite",
        }}
      >
        {emoji}
      </div>

      <h2
        style={{
          fontSize: "1.8rem",
          fontWeight: 700,
          color: "var(--text)",
          margin: 0,
        }}
      >
        Segera Hadir!
      </h2>

      <p
        style={{
          fontSize: "1.1rem",
          color: "var(--text-secondary)",
          maxWidth: 400,
          margin: 0,
          transition: "opacity 0.3s",
        }}
      >
        {WORDS[wordIdx]}
      </p>

      <div
        style={{
          width: "100%",
          maxWidth: 400,
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        <div
          style={{
            width: "100%",
            height: 12,
            background: "var(--surface-hover)",
            borderRadius: 99,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min(progress, 100)}%`,
              height: "100%",
              background: "linear-gradient(90deg, var(--primary), #8b5cf6)",
              borderRadius: 99,
              transition: "width 0.4s ease",
            }}
          />
        </div>
        <span
          style={{
            fontSize: "0.85rem",
            color: "var(--text-muted)",
            fontFamily: "monospace",
          }}
        >
          {Math.min(progress, 100)}% — pengerjaan
        </span>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background:
                progress > (i + 1) * 20
                  ? "var(--primary)"
                  : progress > i * 20
                    ? "var(--warning)"
                    : "var(--surface-hover)",
              transition: "background 0.4s",
            }}
          />
        ))}
      </div>

      <div
        className="card"
        style={{
          maxWidth: 420,
          padding: "1.25rem 1.5rem",
          marginTop: "0.5rem",
        }}
      >
        <p
          style={{
            fontSize: "0.9rem",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          🚀 Fitur ini sedang dalam tahap pengembangan oleh tim Arthakarya.
          Kami akan mengumumkan ketersediaannya melalui pembaruan aplikasi.
        </p>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-16px); }
        }
      `}</style>
    </div>
  );
}
