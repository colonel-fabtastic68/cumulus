import { vcardResponse } from "@/lib/cards";

export function GET(req: Request) {
  return vcardResponse("baker", new URL(req.url).searchParams.get("tab"));
}
