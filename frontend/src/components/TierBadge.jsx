const labels = {
  public: "Public",
  followers: "Followers",
  inner: "Inner Circle",
};

const styles = {
  public: { background: "rgba(16,185,129,0.08)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" },
  followers: { background: "rgba(245,158,11,0.08)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.25)" },
  inner: { background: "rgba(124,58,237,0.10)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.30)" },
};

export default function TierBadge({ tier }) {
  return (
    <span
      data-testid={`tier-badge-${tier}`}
      style={styles[tier] || styles.public}
      className="text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-md font-medium"
    >
      {labels[tier] || tier}
    </span>
  );
}
