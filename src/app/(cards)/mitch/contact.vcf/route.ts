import { vcardResponse } from "@/lib/cards";

export function GET(req: Request) {
  return vcardResponse("mitch", new URL(req.url).searchParams.get("tab"));
}
