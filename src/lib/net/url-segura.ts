import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Proteção contra SSRF (v133): antes de o SERVIDOR baixar uma mídia por um endereço que veio de fora (pacote do Molde ou
 * tela Conteúdo), confere que o endereço é público. Recusa: protocolo que não seja http(s), usuário/senha no endereço,
 * localhost e nomes internos, e qualquer IP privado, de loopback, link-local (ex.: 169.254.169.254, o "metadata" das
 * nuvens), CGNAT, multicast ou reservado, seja escrito direto no endereço, seja o resultado do DNS.
 * O endereço público do R2 (R2_PUBLIC_BASE_URL), de onde vem quase toda mídia, passa direto.
 * Limite conhecido: entre a conferência e o download o DNS pode mudar (DNS rebinding); por isso o download também não
 * segue redirecionamentos (redirect: "error").
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

type Lookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: Lookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export async function assertPublicHttpUrl(raw: string, options: { lookup?: Lookup } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("O endereço da mídia não é válido.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("O endereço da mídia precisa começar com https://.");
  if (url.username || url.password) throw new UnsafeUrlError("O endereço da mídia não pode ter usuário ou senha.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("O endereço da mídia não tem servidor.");

  const r2Host = r2PublicHost();
  if (r2Host && host === r2Host) return url;

  if (host === "localhost" || /\.(localhost|local|internal|intranet|lan|home|corp)$/.test(host) || (!host.includes(".") && !isIP(host))) {
    throw new UnsafeUrlError("O endereço da mídia aponta para a rede interna. Use um link público (de preferência o do R2).");
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError("O endereço da mídia aponta para a rede interna. Use um link público (de preferência o do R2).");
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await (options.lookup ?? defaultLookup)(host);
  } catch {
    throw new UnsafeUrlError("Não achei o servidor da mídia. Confira o link.");
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UnsafeUrlError("O endereço da mídia aponta para a rede interna. Use um link público (de preferência o do R2).");
  }
  return url;
}

function r2PublicHost() {
  try {
    return process.env.R2_PUBLIC_BASE_URL ? new URL(process.env.R2_PUBLIC_BASE_URL).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** IP que não é da internet pública (v4 ou v6, inclusive v4 dentro do v6). */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (isIP(ip) === 4) return isPrivateV4(ip);
  if (isIP(ip) !== 6) return true; // não é IP: na dúvida, recusa
  if (ip === "::" || ip === "::1") return true;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? ip.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(ip.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 (rede local)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && ip.split(":")[1] === "db8") return true; // documentação
  if (first === 0x64 && ip.startsWith("64:ff9b:")) return true; // NAT64
  return false;
}

function isPrivateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast e reservados
  return false;
}
