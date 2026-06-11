const labels = {
  public: "Public",
  followers: "Followers",
  inner: "Inner Circle",
};

export default function TierBadge({ tier }) {
  const cls = `tier-pill-${tier === "inner" ? "inner" : tier}`;
  return (
    <span
      data-testid={`tier-badge-${tier}`}
      className={`${cls} text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-md font-medium`}
    >
      {labels[tier] || tier}
    </span>
  );
}
