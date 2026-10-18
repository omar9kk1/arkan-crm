// Shared, dependency-free search matching for the person/contact lists.
// Extracted verbatim from the manager-clients mock module so real pages no
// longer import a search helper from sample data. Arabic and English are both
// handled: the query and the target are normalised the same way before the
// substring test, so case, Arabic-Indic digits and separators never matter.
export function matchesPerson(
  person: { name: string; phone: string },
  query: string,
) {
  const normalize = (value: string) =>
    value
      .trim()
      .toLocaleLowerCase('ar')
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
      .replace(/[\s()+-]/g, '');
  return normalize(`${person.name} ${person.phone}`).includes(normalize(query));
}
