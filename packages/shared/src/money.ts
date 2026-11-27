/** Dinheiro sempre em centavos (inteiro). Nunca use float para valores. */
export type Cents = number;

export function toCents(reais: number): Cents {
  return Math.round(reais * 100);
}

export function formatBRL(cents: Cents): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Percentual aplicado em centavos, arredondado para o centavo mais próximo. */
export function percentOf(cents: Cents, percent: number): Cents {
  return Math.round((cents * percent) / 100);
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}
