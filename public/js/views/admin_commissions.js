/**
 * Legacy /admin/commissions URL — the Super Admin nav now opens Consultas.
 */
import { navigate } from '../router.js';

export async function adminCommissionsView() {
  navigate('/admin/consultas', { replace: true });
}
