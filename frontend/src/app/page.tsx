import { redirect } from 'next/navigation';

/** 根路徑沒有內容可看——導向 `/s`，由該處判斷 cookie 是否還原得出場次。 */
export default function Home() {
  redirect('/s');
}
