import { getMcpHandler } from '@/lib/mcp';
import { mcpMaintenanceRefusal } from '@/lib/maintenance-refusal';

export const dynamic = 'force-dynamic';

const handle = (request: Request) => mcpMaintenanceRefusal() ?? getMcpHandler().fetch(request);

export { handle as GET, handle as POST, handle as DELETE };
