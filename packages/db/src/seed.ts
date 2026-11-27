/**
 * Seed inicial: cria a organização, a loja, a conta do dono, as metas de tempo
 * e importa o cardápio atual direto do index.html (cardápio estático do repositório).
 *
 * Uso: pnpm db:seed   (lê DATABASE_URL, OWNER_EMAIL e OWNER_PASSWORD do .env)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import bcrypt from 'bcryptjs';
import { PrismaClient, OrderType } from '@prisma/client';

const prisma = new PrismaClient();

type Variacao = { nome: string; preco: number | null };
type Produto = { id: string; categoria: string; nome: string; preco: number | null; descricao?: string; variacoes?: Variacao[] };
type Categoria = { id: string; nome: string };
type Bairro = { nome: string; taxa: number };

/** Lê os arrays BAIRROS, categorias e produtos do index.html sem executar o resto da página. */
export function readStaticMenu(htmlPath: string) {
  const html = readFileSync(htmlPath, 'utf8');
  const grab = (name: string) => {
    const m = html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\]);`));
    if (!m) throw new Error(`Não encontrei "${name}" no index.html`);
    return vm.runInNewContext(`(${m[1]})`, {}, { timeout: 1000 });
  };
  return {
    bairros: grab('BAIRROS') as Bairro[],
    categorias: grab('categorias') as Categoria[],
    produtos: grab('produtos') as Produto[],
  };
}

const cents = (reais: number) => Math.round(reais * 100);

async function main() {
  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  if (!ownerEmail || !ownerPassword || ownerPassword.length < 8) {
    throw new Error('Defina OWNER_EMAIL e OWNER_PASSWORD (mínimo 8 caracteres) no .env');
  }

  const existing = await prisma.store.findFirst();
  if (existing) {
    console.log('Banco já tem loja cadastrada; seed não foi repetido.');
    return;
  }

  const org = await prisma.organization.create({ data: { name: 'Seu Alves Lanches', taxRegime: 'MEI' } });
  const store = await prisma.store.create({ data: { organizationId: org.id, name: 'Vila Kosmos' } });

  const owner = await prisma.user.create({
    data: { name: 'Dono', email: ownerEmail, passwordHash: await bcrypt.hash(ownerPassword, 12) },
  });
  await prisma.storeUser.create({ data: { userId: owner.id, storeId: store.id, role: 'DONO' } });

  // Metas de tempo padrão (minutos), ajustáveis depois pela tela de configurações.
  const targets: [OrderType, string, number][] = [
    ['ENTREGA', 'ACEITE', 2], ['ENTREGA', 'PREPARO', 15], ['ENTREGA', 'ESPERA_MOTOBOY', 5], ['ENTREGA', 'ROTA', 15],
    ['BALCAO', 'ACEITE', 1], ['BALCAO', 'PREPARO', 12], ['BALCAO', 'ENTREGA_BALCAO', 3],
    ['RETIRADA', 'ACEITE', 1], ['RETIRADA', 'PREPARO', 12], ['RETIRADA', 'ENTREGA_BALCAO', 3],
  ];
  await prisma.serviceTarget.createMany({
    data: targets.map(([orderType, stage, targetMinutes]) => ({ storeId: store.id, orderType, stage, targetMinutes })),
  });

  const menu = readStaticMenu(resolve(__dirname, '../../../index.html'));

  await prisma.deliveryZone.createMany({
    data: menu.bairros.map((b) => ({ storeId: store.id, name: b.nome, feeCents: cents(b.taxa) })),
  });

  const catIds = new Map<string, string>();
  for (const [i, c] of menu.categorias.entries()) {
    const cat = await prisma.category.create({ data: { storeId: store.id, name: c.nome, position: i } });
    catIds.set(c.id, cat.id);
  }

  let imported = 0;
  const skipped: string[] = [];
  for (const p of menu.produtos) {
    const priced = (p.variacoes ?? []).filter((v) => v.preco != null) as { nome: string; preco: number }[];
    const base = priced.length ? Math.min(...priced.map((v) => v.preco)) : p.preco;
    if (base == null || !catIds.has(p.categoria)) {
      skipped.push(p.nome);
      continue;
    }
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        categoryId: catIds.get(p.categoria)!,
        name: p.nome,
        description: p.descricao,
        basePriceCents: cents(base),
      },
    });
    if (priced.length > 1) {
      const group = await prisma.optionGroup.create({
        data: {
          storeId: store.id,
          name: `Tamanho · ${p.nome}`,
          min: 1,
          max: 1,
          options: { create: priced.map((v) => ({ name: v.nome, priceCents: cents(v.preco - base) })) },
        },
      });
      await prisma.productOptionGroup.create({ data: { productId: product.id, optionGroupId: group.id } });
    }
    imported++;
  }

  console.log(`Loja criada: ${store.name} (${store.id})`);
  console.log(`Dono: ${ownerEmail}`);
  console.log(`Cardápio importado: ${imported} produtos, ${menu.bairros.length} bairros.`);
  if (skipped.length) console.log(`Sem preço no index.html (cadastrar depois): ${skipped.join(', ')}`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
