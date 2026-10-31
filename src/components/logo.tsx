import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link className="wordmark" href={href}>
      <span className="mark" aria-hidden="true" />
      <span>
        <em>Brazo</em> Derecho
      </span>
    </Link>
  );
}
