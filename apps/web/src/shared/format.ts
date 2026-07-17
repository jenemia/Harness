import type { SupportedLocale } from "../i18n";

export function formatDate(value: string, locale?: SupportedLocale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDuration(startedAt: string, completedAt: string, locale?: SupportedLocale) {
  const milliseconds = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (locale === "ko") {
    return [hours ? `${hours}시간` : "", minutes ? `${minutes}분` : "", (!hours && !minutes) || seconds ? `${seconds}초` : ""]
      .filter(Boolean)
      .join(" ");
  }
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", (!hours && !minutes) || seconds ? `${seconds}s` : ""]
    .filter(Boolean)
    .join(" ");
}
