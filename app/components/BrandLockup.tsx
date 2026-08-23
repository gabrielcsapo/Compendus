import { CompendusLogo } from "./CompendusLogo";
import { CompendusWordmark } from "./CompendusWordmark";

export function BrandLockup({
  className = "",
  logoClassName = "h-7 w-7",
  wordmarkClassName = "h-[1.35rem] w-auto",
}: {
  className?: string;
  logoClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <CompendusLogo className={logoClassName} />
      <CompendusWordmark className={wordmarkClassName} />
      <span className="sr-only">Compendus</span>
    </span>
  );
}
