import type { PublicInstagramAccount } from "@/lib/instagram/public-account";

export type AccountRouteSearchParams = {
  accountId?: string | string[];
};

export function getSelectedAccountId(params: AccountRouteSearchParams | null | undefined, accounts: Pick<PublicInstagramAccount, "id" | "is_default">[]) {
  const requested = Array.isArray(params?.accountId) ? params?.accountId[0] : params?.accountId;
  const requestedAccount = accounts.find((account) => account.id === requested);
  if (requestedAccount) return requestedAccount.id;

  return accounts.find((account) => account.is_default)?.id ?? accounts[0]?.id ?? null;
}

export function hrefWithAccount(href: string, accountId?: string | null) {
  if (!accountId) return href;

  const [beforeHash, hash] = href.split("#");
  const [pathname, query = ""] = beforeHash.split("?");
  const params = new URLSearchParams(query);
  params.set("accountId", accountId);

  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}
