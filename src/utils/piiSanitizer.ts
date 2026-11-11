/**
 * Utilidad de sanitización de datos personales sensibles (PII)
 * Cumple con la Regla IA-03 (RF-14 / Ética UTS)
 */
export class PIISanitizer {
  // Regex para números de documento colombianos (entre 6 y 10 dígitos)
  private static readonly CEDULA_REGEX = /\b\d{6,10}\b/g;

  // Regex para correos electrónicos
  private static readonly EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  // Regex para números telefónicos y móviles en Colombia
  private static readonly PHONE_REGEX = /\b(?:\+57\s?)?(?:3\d{9}|[1-9]\d{6})\b/g;

  public static sanitize(text: string): string {
    if (!text) return '';

    return text
      .replace(this.EMAIL_REGEX, '[CORREO_ANONIMIZADO]')
      .replace(this.PHONE_REGEX, '[TELEFONO_ANONIMIZADO]')
      .replace(this.CEDULA_REGEX, '[DOC_ANONIMIZADO]');
  }
}

