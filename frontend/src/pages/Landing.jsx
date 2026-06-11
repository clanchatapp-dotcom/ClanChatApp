import { Link } from "react-router-dom";
import { Lock, Eye, Users, Sparkles } from "lucide-react";

export default function Landing() {
  return (
    <div className="px-6 pt-12 pb-24 min-h-screen relative grain">
      <div className="relative z-10">
        <div className="text-[10px] uppercase tracking-[0.4em] text-zinc-500">ClanChat</div>
        <h1 className="font-heading text-5xl mt-6 leading-[1.02]">
          Your<br />
          <span className="text-[#FF5A00]">Personal</span><br />
          Clubhouse.
        </h1>
        <p className="text-zinc-400 mt-6 max-w-sm leading-relaxed">
          A privacy-first social space with three tiers — public, followers, inner circle.
          No algorithm. No public follower counts. # handles only.
        </p>

        <div className="mt-10 flex flex-col gap-3 max-w-sm">
          <Link to="/register" className="cc-btn-primary text-center" data-testid="landing-cta-register">
            Create your space
          </Link>
          <Link to="/login" className="cc-btn-secondary text-center" data-testid="landing-cta-login">
            I already have an account
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-16 max-w-md">
          <Feature icon={Eye} label="Three Tiers" sub="Public • Followers • Inner Circle" />
          <Feature icon={Lock} label="Privacy First" sub="Private metrics, anonymous likes" />
          <Feature icon={Users} label="Invite Only Inner" sub="No requests, only invites" />
          <Feature icon={Sparkles} label="No Algorithm" sub="Pure chronological feed" />
        </div>

        <p className="text-zinc-700 text-xs mt-16">© ClanChat — Built for trust.</p>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, label, sub }) {
  return (
    <div className="border border-zinc-900 rounded-2xl p-4">
      <Icon className="text-[#FF5A00]" size={18} />
      <div className="font-medium mt-3 text-sm">{label}</div>
      <div className="text-zinc-500 text-xs mt-1 leading-relaxed">{sub}</div>
    </div>
  );
}
