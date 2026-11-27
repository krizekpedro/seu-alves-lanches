import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapOlaclickMenu, type OlaCardapio } from './olaclick';

const real = JSON.parse(
  readFileSync(resolve(__dirname, '../../../data/olaclick/cardapio.json'), 'utf8'),
) as OlaCardapio;

describe('mapOlaclickMenu', () => {
  const menu = mapOlaclickMenu(real);

  it('ignora a vitrine de Destaques e mantém as categorias na ordem', () => {
    expect(menu.categorias.map((c) => c.nome)).not.toContain('Destaques');
    expect(menu.categorias[0].nome).toBe('PROMOÇÕES');
    expect(menu.categorias.map((c) => c.posicao)).toEqual(menu.categorias.map((_, i) => i));
  });

  it('descarta grupos "Sem nome" e itens escondidos', () => {
    expect(menu.grupos.some((g) => /sem nome/i.test(g.nome))).toBe(false);
    const adicionais = menu.grupos.find((g) => g.nome === 'ADICIONAIS')!;
    expect(adicionais.min).toBe(0); // opcional na OlaClick
    expect(adicionais.opcoes.find((o) => o.nome === 'OVO')?.precoCentavos).toBe(200);
  });

  it('respeita o mínimo dos grupos obrigatórios', () => {
    const sabor = menu.grupos.find((g) => g.nome === 'Escolha o sabor')!;
    expect([sabor.min, sabor.max]).toEqual([1, 1]);
  });

  it('transforma tamanhos em acréscimos sobre o menor preço', () => {
    const acai = menu.categorias.flatMap((c) => c.produtos).find((p) => p.nome === 'AÇAÍ')!;
    expect(acai.precoBaseCentavos).toBe(600);
    expect(acai.tamanhos.map((t) => t.precoCentavos)).toEqual([0, 300, 800, 1100]);
    expect(acai.tamanhos.find((t) => t.nome === '700ml')?.ativo).toBe(false);
    expect(acai.disponivel).toBe(true);
  });

  it('só liga produtos a grupos que foram importados', () => {
    const refs = new Set(menu.grupos.map((g) => g.ref));
    for (const p of menu.categorias.flatMap((c) => c.produtos)) {
      for (const g of p.grupos) expect(refs.has(g)).toBe(true);
    }
  });

  it('mantém produtos escondidos como inativos e descarta rascunhos', () => {
    const todos = menu.categorias.flatMap((c) => c.produtos);
    expect(todos.find((p) => p.nome === 'Guaraviton')?.ativo).toBe(false);
    expect(todos.some((p) => p.nome === 'Produto 16')).toBe(false);
  });
});
