import Image from 'next/image';

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-logo" aria-hidden="true">
        <Image
          src="/brand/arkan-gulf-logo.png"
          alt=""
          width={375}
          height={666}
        />
      </span>
      <strong>أركان الخليج العقارية</strong>
    </div>
  );
}
