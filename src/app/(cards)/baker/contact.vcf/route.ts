import { vcardResponse } from "@/lib/cards";

export function GET() {
  return vcardResponse("baker");
}
