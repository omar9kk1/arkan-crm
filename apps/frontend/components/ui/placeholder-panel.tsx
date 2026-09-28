export function PlaceholderPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="panel">
      <p className="eyebrow">المرحلة التأسيسية</p>
      <h1>{title}</h1>
      <p>{description}</p>
      <span className="badge">قالب معاينة • لا توجد بيانات تشغيلية</span>
    </section>
  );
}
