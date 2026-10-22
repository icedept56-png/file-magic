export function Background() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* ambient orbs */}
      <div className="fm-orb-1 absolute left-[-80px] top-[-120px] h-[480px] w-[480px] rounded-full bg-fuchsia-600 opacity-[0.22] blur-3xl" />
      <div className="fm-orb-2 absolute right-[-120px] top-[30%] h-[420px] w-[420px] rounded-full bg-violet-600 opacity-[0.22] blur-3xl" />
      <div className="fm-orb-3 absolute bottom-[-140px] left-[30%] h-[400px] w-[400px] rounded-full bg-orange-500 opacity-[0.22] blur-3xl" />

      {/* faint grid overlay */}
      <div className="fm-grid absolute inset-0" />

      {/* subtle vignette pulling edges into the base color */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,rgba(7,7,13,0.8)_100%)]" />
    </div>
  );
}
