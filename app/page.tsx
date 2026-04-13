import { ShopperHomepage } from "@/components/shopper/shopper-homepage";
import { getShopperHomepageData } from "@/lib/shopper/homepage-data";

export const revalidate = 30;

export default async function Home() {
  const homepageData = await getShopperHomepageData();

  return (
    <ShopperHomepage
      products={homepageData.products}
      initialSessionId=""
      activeProducts={homepageData.activeProducts}
    />
  );
}
