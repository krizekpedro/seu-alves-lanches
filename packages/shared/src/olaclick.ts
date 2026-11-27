/**
 * Converte o cardápio exportado do painel da OlaClick (data/olaclick/cardapio.json)
 * para o formato do nosso catálogo: categorias, produtos, tamanhos e grupos de adicionais.
 * Função pura: quem grava no banco é o seed (packages/db/src/seed.ts).
 */

export type OlaVariacao = { nome: string | null; preco: number; esgotado: boolean };
export type OlaProduto = {
  id: string;
  nome: string;
  descricao: string | null;
  visivel: boolean;
  posicao: number;
  foto: string | null;
  variacoes: OlaVariacao[];
  grupos: string[];
};
export type OlaCategoria = { id: string; nome: string; posicao: number; destaque: boolean; produtos: OlaProduto[] };
export type OlaItem = { nome: string; preco: number; maxPorItem: number; visivel: boolean; esgotado: boolean };
export type OlaGrupo = { id: string; nome: string; min: number; max: number; obrigatorio: boolean; ativo: boolean; itens: OlaItem[] };
export type OlaCardapio = { categorias: OlaCategoria[]; grupos: OlaGrupo[] };

export type MenuOpcao = { nome: string; precoCentavos: number; ativo: boolean };
export type MenuGrupo = { ref: string; nome: string; min: number; max: number; opcoes: MenuOpcao[] };
export type MenuProduto = {
  nome: string;
  descricao: string | null;
  foto: string | null;
  precoBaseCentavos: number;
  disponivel: boolean;
  ativo: boolean;
  /** Tamanhos (P/M/G, 200 ml…): preço de cada um como acréscimo sobre o preço base. */
  tamanhos: MenuOpcao[];
  grupos: string[];
};
export type MenuCategoria = { nome: string; posicao: number; produtos: MenuProduto[] };
export type MenuImportado = { categorias: MenuCategoria[]; grupos: MenuGrupo[] };

const centavos = (reais: number) => Math.round(reais * 100);
const semNome = (nome: string | null | undefined) => !nome || /^sem nome$/i.test(nome.trim());

export function mapOlaclickMenu(menu: OlaCardapio): MenuImportado {
  // Grupos: ignora os desativados, os "Sem nome" (rascunhos da OlaClick) e os sem nenhum item visível.
  // Na OlaClick o mínimo só vale quando o grupo é obrigatório; nos outros o cliente pode pular.
  const grupos: MenuGrupo[] = [];
  for (const g of menu.grupos) {
    const itens = g.itens.filter((i) => i.visivel && !semNome(i.nome));
    if (!g.ativo || semNome(g.nome) || itens.length === 0) continue;
    const max = Math.max(1, g.max);
    grupos.push({
      ref: g.id,
      nome: g.nome.trim(),
      min: g.obrigatorio ? Math.min(g.min, max) : 0,
      max,
      opcoes: itens.map((i) => ({ nome: i.nome.trim(), precoCentavos: centavos(i.preco), ativo: !i.esgotado })),
    });
  }
  const gruposValidos = new Set(grupos.map((g) => g.ref));

  // "Destaques" é uma vitrine que repete produtos de outras categorias: não vira categoria.
  const categorias = menu.categorias
    .filter((c) => !c.destaque)
    .sort((a, b) => a.posicao - b.posicao)
    .map((c, idx) => ({
      nome: c.nome.trim(),
      posicao: idx,
      produtos: [...c.produtos]
        .sort((a, b) => a.posicao - b.posicao)
        .filter((p) => !/^produto \d+$/i.test(p.nome.trim()))
        .map((p): MenuProduto => {
          const vars = p.variacoes.length ? p.variacoes : [{ nome: null, preco: 0, esgotado: false }];
          const base = Math.min(...vars.map((v) => v.preco));
          const tamanhos =
            vars.length > 1
              ? vars.map((v, i) => ({
                  nome: v.nome?.trim() || `Opção ${i + 1}`,
                  precoCentavos: centavos(v.preco - base),
                  ativo: !v.esgotado,
                }))
              : [];
          return {
            nome: p.nome.trim(),
            descricao: p.descricao?.trim() || null,
            foto: p.foto,
            precoBaseCentavos: centavos(base),
            disponivel: vars.some((v) => !v.esgotado),
            ativo: p.visivel,
            tamanhos,
            grupos: p.grupos.filter((id) => gruposValidos.has(id)),
          };
        }),
    }));

  return { categorias, grupos };
}
