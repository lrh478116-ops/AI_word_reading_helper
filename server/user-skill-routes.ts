import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { translate, normalizeLanguage } from '../src/i18n.ts';
import { SKILL_LIMITS } from '../src/user-skills.ts';
import { exportSkill, parseSkillFiles, parseSkillUpload, SkillError, type UserSkillStore } from './user-skills.ts';

type SkillRequest = Request & { user?: { id: string } };
export function skillErrorResponse(req: Request, res: Response, error: unknown) {
  const code = error instanceof SkillError ? error.code : error instanceof multer.MulterError ? 'limit' : 'storage';
  const status = code === 'missing' ? 404 : ['stale', 'duplicate', 'budget', 'integrity'].includes(code) ? 409 : code === 'storage' ? 500 : 400;
  return res.status(status).json({ error: translate(normalizeLanguage(req.body?.language || req.query.language), `skills.error.${code}`), code: `SKILL_${code.toUpperCase()}` });
}
export function userSkillRoutes(store: UserSkillStore) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: SKILL_LIMITS.uploadBytes, files: 1, fields: 2 } }).single('file');
  const owner = (req: Request) => (req as SkillRequest).user!.id;
  const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { void fn(req, res).catch(error => skillErrorResponse(req, res, error)); };
  router.get('/', run(async (req, res) => res.json({ skills: await store.list(owner(req)), limits: SKILL_LIMITS })));
  router.post('/preview', (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, error => error ? skillErrorResponse(req, res, error) : next());
  }, run(async (req, res) => {
    let filename = req.file?.originalname || '';
    if (Array.from(filename).every(c => c.charCodeAt(0) <= 255)) {
      try { filename = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(filename, 'latin1')); } catch { /* A genuine non-UTF8 filename is kept; content decoding remains strict. */ }
    }
    const preview = req.file ? await parseSkillUpload(filename, req.file.buffer) : parseSkillFiles(req.body?.files);
    res.json({ preview });
  }));
  router.post('/', run(async (req, res) => res.status(201).json({ skill: await store.create(owner(req), req.body) })));
  router.patch('/:id', run(async (req, res) => res.json({ skill: await store.update(owner(req), String(req.params.id), req.body || {}) })));
  router.delete('/:id', run(async (req, res) => { await store.delete(owner(req), String(req.params.id), req.body?.signature); res.json({ deleted: true }); }));
  router.get('/:id/export', run(async (req, res) => {
    const skill = (await store.list(owner(req))).find(s => s.id === req.params.id);
    if (!skill) throw new SkillError('missing');
    const data = await exportSkill(skill);
    res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename="reading-skill.zip"'); res.send(data);
  }));
  return router;
}
