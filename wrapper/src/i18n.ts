import { french } from './fr';

const interpolate = (text: string, values: (string | number)[]) =>
  text.replace(/\{(\d+)\}/g, (token, index: string) =>
    String(values[Number(index)] ?? token),
  );

export function translate(
  language: 'en' | 'fr',
  message: string,
  ...values: (string | number)[]
) {
  const key = message.trim();
  if (language === 'en') return interpolate(message, values);
  if (french[key])
    return interpolate(
      message.replace(key, () => french[key]),
      values,
    );
  if (!values.length) {
    for (const [template, translation] of Object.entries(french)) {
      if (
        !template.includes('{0}') ||
        !/[A-Za-z]/.test(template.replace(/\{\d+\}/g, ''))
      )
        continue;
      const pattern = template
        .split(/\{\d+\}/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('(.+?)');
      const match = new RegExp(`^${pattern}$`).exec(key);
      if (match) return interpolate(translation, match.slice(1));
    }
  }
  return interpolate(message, values);
}
