import { APP_NAME } from "@/app/constants";

export default function SocialCard() {
  return (
    <div
      style={{
        alignItems: "stretch",
        background: "linear-gradient(135deg, #08182f 0%, #12345a 58%, #156b76 100%)",
        color: "#f7fbff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: "64px 72px",
        position: "relative",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          fontSize: 30,
          fontWeight: 700,
          gap: 18,
          letterSpacing: "-0.02em",
        }}
      >
        <div
          style={{
            alignItems: "center",
            background: "#ffb45e",
            borderRadius: 18,
            color: "#102743",
            display: "flex",
            fontSize: 32,
            height: 62,
            justifyContent: "center",
            width: 62,
          }}
        >
          H
        </div>
        {APP_NAME}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 900 }}>
        <div
          style={{
            color: "#ffca88",
            display: "flex",
            fontSize: 23,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Built for speaking classrooms
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 68,
            fontWeight: 800,
            letterSpacing: "-0.045em",
            lineHeight: 1.02,
          }}
        >
          Speaking practice made simple.
        </div>
        <div style={{ color: "#d7e8f2", display: "flex", fontSize: 28, lineHeight: 1.35 }}>
          Assign prompts, collect recordings, and turn student voice into useful feedback.
        </div>
      </div>

      <div style={{ color: "#b9d6df", display: "flex", fontSize: 23 }}>
        tryhabla.com
      </div>

      <div
        style={{
          border: "3px solid rgba(255, 202, 136, 0.45)",
          borderRadius: 999,
          display: "flex",
          height: 280,
          position: "absolute",
          right: -42,
          top: 70,
          width: 280,
        }}
      />
      <div
        style={{
          background: "rgba(255, 180, 94, 0.14)",
          borderRadius: 999,
          display: "flex",
          height: 160,
          position: "absolute",
          right: 26,
          top: 130,
          width: 160,
        }}
      />
    </div>
  );
}
