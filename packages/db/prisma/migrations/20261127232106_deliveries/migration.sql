-- CreateEnum
CREATE TYPE "DeliveryProvider" AS ENUM ('PROPRIO', 'IFOOD', 'N99');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('COTADA', 'SOLICITADA', 'ENTREGADOR_ATRIBUIDO', 'NA_LOJA', 'COLETADA', 'CHEGANDO', 'ENTREGUE', 'CANCELADA', 'FALHOU');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "notify_radius_m" INTEGER NOT NULL DEFAULT 800;

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "DeliveryProvider" NOT NULL,
    "external_id" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SOLICITADA',
    "fee_cents" INTEGER,
    "courier_name" TEXT,
    "courier_phone" TEXT,
    "courier_user_id" UUID,
    "courier_lat" DOUBLE PRECISION,
    "courier_lng" DOUBLE PRECISION,
    "dest_lat" DOUBLE PRECISION,
    "dest_lng" DOUBLE PRECISION,
    "tracking_url" TEXT,
    "customer_notified_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_at" TIMESTAMP(3),
    "arrived_store_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "last_payload" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliveries_order_id_idx" ON "deliveries"("order_id");

-- CreateIndex
CREATE INDEX "deliveries_status_idx" ON "deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_provider_external_id_key" ON "deliveries"("provider", "external_id");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
