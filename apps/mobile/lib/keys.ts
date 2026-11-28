import { EngineError } from '@ghostaff/shared/services';

// Words for Conexiones › Claves (docs/plans/ongoing/secrets-from-the-app.md).

/** «Correo», «Correo y Finanzas», «Correo, Finanzas y Productor». */
export function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** Why the engine did not store, replace, decide or remove a key, in plain Spanish. */
export function keyErrorMessage(e: unknown): string {
  const code = e instanceof EngineError ? e.code : 'failed';
  switch (code) {
    case 'unreachable':
      return 'No hay conexión. Comprueba tu internet y prueba otra vez.';
    case 'value_too_short':
      return 'Es demasiado corta: tiene que tener al menos 8 caracteres.';
    case 'value_too_long':
      return 'Es demasiado larga para una clave.';
    case 'value_nul':
      return 'Tiene un carácter que no se puede guardar. Cópiala otra vez.';
    case 'bad_label':
      return 'Ponle un nombre de hasta 80 caracteres.';
    case 'bad_name':
      return 'Ponle un nombre con alguna letra o número.';
    case 'exists':
      return 'Ya hay una clave con ese nombre. Ábrela para cambiarla, o ponle otro nombre.';
    case 'not_found':
      return 'Esta clave ya no existe. Actualiza la pantalla.';
    case 'not_owner':
      return 'Solo quien es propietario puede hacerlo.';
    case 'not_member':
      return 'No formas parte de esta empresa.';
    case 'nothing_pending':
    case 'conflict':
      return 'Alguien la cambió mientras tanto. Mira cómo está ahora.';
    case 'gone':
      return 'El valor que esperaba ya no está guardado. Hay que volver a guardarlo.';
    default:
      return 'No hemos podido hacerlo. Prueba otra vez.';
  }
}
