const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders });
}

async function responseMessage(response) {
  const body = await response.json().catch(() => ({}));
  return String(body?.message || body?.msg || body?.error_description || body?.error || `upstream ${response.status}`);
}

function requiredConfig(config) {
  const normalized = {
    supabaseUrl: String(config?.supabaseUrl || "").replace(/\/$/, ""),
    publishableKey: String(config?.publishableKey || ""),
    serviceRoleKey: String(config?.serviceRoleKey || ""),
    bucket: String(config?.bucket || "ai-document-files"),
    listPageSize: Math.min(1000, Math.max(1, Number(config?.listPageSize) || 100))
  };
  if (!normalized.supabaseUrl || !normalized.publishableKey || !normalized.serviceRoleKey) throw new Error("Delete-account function is not configured");
  return normalized;
}

export function createDeleteAccountHandler(inputConfig, fetcher = fetch) {
  const config = requiredConfig(inputConfig);
  return async function deleteAccount(request) {
    if (request.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
    const authorization = String(request.headers.get("authorization") || "");
    if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ error: "Authentication required" }, 401);

    try {
      const userResponse = await fetcher(`${config.supabaseUrl}/auth/v1/user`, {
        method: "GET",
        headers: { apikey: config.publishableKey, Authorization: authorization }
      });
      if (!userResponse.ok) return json({ error: "Authentication required" }, 401);
      const user = await userResponse.json().catch(() => null);
      if (!user || typeof user.id !== "string" || !user.id) return json({ error: "Authentication required" }, 401);

      const prefix = `${user.id}/`;
      const objectPaths = [];
      for (let offset = 0, page = 0; page < 1000; page += 1) {
        const listResponse = await fetcher(`${config.supabaseUrl}/storage/v1/object/list/${encodeURIComponent(config.bucket)}`, {
          method: "POST",
          headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prefix, limit: config.listPageSize, offset, sortBy: { column: "name", order: "asc" } })
        });
        if (!listResponse.ok) throw new Error(`Could not enumerate account files: ${await responseMessage(listResponse)}`);
        const listed = await listResponse.json().catch(() => null);
        if (!Array.isArray(listed)) throw new Error("Storage list response was invalid");
        for (const object of listed) {
          if (!object || typeof object.name !== "string" || !object.name) continue;
          const objectPath = object.name.startsWith(prefix) ? object.name : `${prefix}${object.name.replace(/^\/+/, "")}`;
          if (objectPath.startsWith(prefix)) objectPaths.push(objectPath);
        }
        if (listed.length < config.listPageSize) break;
        offset += listed.length;
        if (page === 999) throw new Error("Account file enumeration exceeded the safety limit");
      }

      if (objectPaths.length) {
        const removeResponse = await fetcher(`${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(config.bucket)}`, {
          method: "DELETE",
          headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: [...new Set(objectPaths)] })
        });
        if (!removeResponse.ok) throw new Error(`Could not delete account files: ${await responseMessage(removeResponse)}`);
      }

      const deleteResponse = await fetcher(`${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, "Content-Type": "application/json" }
      });
      if (!deleteResponse.ok) throw new Error(`Could not delete account: ${await responseMessage(deleteResponse)}`);
      return json({ deleted: true, userId: user.id, storageObjectsDeleted: objectPaths.length });
    } catch (error) {
      console.error("delete-account failed", error instanceof Error ? error.message : String(error));
      return json({ error: "Account deletion could not be completed. No success was recorded." }, 502);
    }
  };
}
