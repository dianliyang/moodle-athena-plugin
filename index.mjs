const DEFAULT_MOODLE_URL = 'https://elearn.informatik.uni-kiel.de'
const DEFAULT_TIMEZONE = 'Europe/Berlin'
const SOURCE = 'moodle-sync'

function nowIso() {
  return new Date().toISOString()
}

function normalizeBaseUrl(value) {
  const raw = typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : DEFAULT_MOODLE_URL
  const url = new URL(raw)
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function stripHtml(value) {
  return typeof value === 'string'
    ? value
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/\s+/g, ' ')
        .trim()
    : ''
}

function decodeHtml(value) {
  return stripHtml(value)
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function moodleTimestampToIso(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return new Date(value * 1000).toISOString()
}

function buildMoodleRestUrl(baseUrl, config, wsfunction, params = {}) {
  const url = new URL(`${baseUrl}/webservice/rest/server.php`)
  url.searchParams.set('wsfunction', wsfunction)
  url.searchParams.set('moodlewsrestformat', 'json')

  if (typeof config.token === 'string' && config.token.trim().length > 0) {
    url.searchParams.set('wstoken', config.token.trim())
  }

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  }

  return url.toString()
}

async function fetchMoodleJson(context, baseUrl, config, wsfunction, params) {
  const response = await context.fetch({
    url: buildMoodleRestUrl(baseUrl, config, wsfunction, params),
    method: 'GET',
  })

  if (response.status !== 200) {
    throw new Error(`Moodle API returned HTTP ${response.status} for ${wsfunction}.`)
  }

  let parsed
  try {
    parsed = JSON.parse(response.bodyText)
  } catch {
    throw new Error(`Moodle API returned invalid JSON for ${wsfunction}.`)
  }

  if (parsed && typeof parsed === 'object' && parsed.exception) {
    throw new Error(`Moodle API error for ${wsfunction}: ${parsed.message ?? parsed.errorcode ?? 'Unknown error'}.`)
  }

  return parsed
}

function normalizePath(value, fallback) {
  const raw = typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback
  return raw.startsWith('/') ? raw : `/${raw}`
}

async function ensureBrowserLogin(context, baseUrl, loginPath = '/login/index.php') {
  const response = await context.fetch({
    url: `${baseUrl}/my/`,
    method: 'GET',
  })

  if (!response.finalUrl.includes('/login/index.php') && response.status < 400) {
    return null
  }

  const authResult = await context.browserAuth({
    url: `${baseUrl}${loginPath}`,
    completeUrlPrefix: `${baseUrl}/my/`,
  })

  if (authResult.status === 'success') {
    return null
  }

  return `Browser login ${authResult.status}: ${authResult.error || 'User cancelled'}.`
}

function getCourseUrl(baseUrl, moodleCourse) {
  return `${baseUrl}/course/view.php?id=${moodleCourse.id}`
}

function getModuleUrl(baseUrl, module) {
  if (typeof module.url === 'string' && module.url.trim().length > 0) {
    return module.url
  }
  if (module.id !== undefined && module.id !== null) {
    return `${baseUrl}/mod/${module.modname ?? 'resource'}/view.php?id=${module.id}`
  }
  return null
}

function resolveMoodleUrl(baseUrl, href) {
  try {
    return new URL(href, `${baseUrl}/`).toString()
  } catch {
    return null
  }
}

function getMoodleCourseIdFromUrl(value) {
  try {
    const url = new URL(value)
    if (!url.pathname.endsWith('/course/view.php')) {
      return null
    }
    const id = url.searchParams.get('id')
    return id && /^\d+$/.test(id) ? id : null
  } catch {
    return null
  }
}

function getMoodleModuleIdFromUrl(value) {
  try {
    const url = new URL(value)
    if (!url.pathname.includes('/mod/')) {
      return null
    }
    const id = url.searchParams.get('id')
    return id && /^\d+$/.test(id) ? id : null
  } catch {
    return null
  }
}

function extractLinks(html, baseUrl) {
  const links = []
  const linkPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match

  while ((match = linkPattern.exec(html)) !== null) {
    const attributes = match[1] ?? ''
    const hrefMatch = attributes.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
    const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? null
    if (!href) {
      continue
    }

    const url = resolveMoodleUrl(baseUrl, href)
    if (!url) {
      continue
    }

    links.push({
      url,
      text: decodeHtml(match[2] ?? ''),
    })
  }

  return links
}

function extractCourseLinks(html, baseUrl) {
  const coursesById = new Map()
  for (const link of extractLinks(html, baseUrl)) {
    const courseId = getMoodleCourseIdFromUrl(link.url)
    if (!courseId) {
      continue
    }

    const title = link.text || `Moodle course ${courseId}`
    if (!coursesById.has(courseId) || title.length > coursesById.get(courseId).title.length) {
      coursesById.set(courseId, {
        id: Number(courseId),
        title,
        url: `${baseUrl}/course/view.php?id=${courseId}`,
      })
    }
  }

  return [...coursesById.values()]
}

function extractPageTitle(html) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1) {
    return decodeHtml(h1[1])
  }

  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  return title ? decodeHtml(title[1]).replace(/\s*\|\s*.+$/, '').trim() : ''
}

function extractResourcesFromCourseHtml(html, baseUrl) {
  const resourcesByUrl = new Map()
  for (const link of extractLinks(html, baseUrl)) {
    if (!getMoodleModuleIdFromUrl(link.url)) {
      continue
    }

    const label = link.text || 'Moodle item'
    if (!resourcesByUrl.has(link.url)) {
      resourcesByUrl.set(link.url, {
        label,
        value: link.url,
      })
    }
  }

  return [...resourcesByUrl.values()].slice(0, 80)
}

function classifyTaskType(module) {
  switch (module.modname) {
    case 'assign':
      return 'assignment'
    case 'quiz':
      return 'exam'
    case 'lesson':
    case 'book':
    case 'resource':
    case 'url':
    case 'page':
      return 'reading'
    case 'workshop':
      return 'project'
    default:
      return 'custom'
  }
}

function classifySessionCategory(taskType) {
  switch (taskType) {
    case 'assignment':
    case 'homework':
      return 'academic.assignment'
    case 'exam':
      return 'academic.exam'
    case 'reading':
      return 'academic.reading'
    case 'project':
      return 'academic.project'
    case 'lab':
      return 'academic.lab'
    default:
      return 'academic.default'
  }
}

function extractModuleDueAt(module) {
  for (const dateEntry of asArray(module.dates)) {
    const label = `${dateEntry.label ?? ''} ${dateEntry.type ?? ''}`.toLowerCase()
    if (label.includes('due') || label.includes('close') || label.includes('deadline') || label.includes('abgabe')) {
      return moodleTimestampToIso(dateEntry.timestamp)
    }
  }

  if (typeof module.customdata === 'string') {
    try {
      const custom = JSON.parse(module.customdata)
      return (
        moodleTimestampToIso(custom.duedate)
        ?? moodleTimestampToIso(custom.timeclose)
        ?? moodleTimestampToIso(custom.deadline)
      )
    } catch {
      return null
    }
  }

  return null
}

function collectCourseContents(baseUrl, moodleCourse, sections) {
  const resources = []
  const modules = []

  for (const [sectionIndex, section] of asArray(sections).entries()) {
    const sectionModules = asArray(section.modules)
    const syllabusTasks = []
    const chapters = []

    for (const module of sectionModules) {
      const title = stripHtml(module.name) || module.modplural || 'Moodle item'
      const url = getModuleUrl(baseUrl, module)
      const taskType = classifyTaskType(module)
      const dueAt = extractModuleDueAt(module)
      const moduleId = String(module.id ?? `${sectionIndex}-${chapters.length}`)

      chapters.push(title)

      if (url) {
        resources.push({ label: title, value: url })
      }

      if (dueAt) {
        syllabusTasks.push({
          id: `moodle-${moodleCourse.id}-task-${moduleId}`,
          title,
          type: taskType,
          dueAt,
          startAt: null,
          endAt: null,
        })
      }
    }

    modules.push({
      id: `moodle-${moodleCourse.id}-section-${section.id ?? sectionIndex}`,
      title: stripHtml(section.name) || `Section ${sectionIndex + 1}`,
      startAt: null,
      endAt: null,
      chapters,
      tasks: syllabusTasks,
    })
  }

  return {
    resources: resources.slice(0, 80),
    syllabus: { modules },
  }
}

function mapCourse(baseUrl, moodleCourse, sections, syncedAt) {
  const courseContents = collectCourseContents(baseUrl, moodleCourse, sections)
  const summary = stripHtml(moodleCourse.summary)

  return {
    id: `moodle-${moodleCourse.id}`,
    university: 'Kiel University',
    domain: 'Informatics',
    category: 'course',
    language: null,
    source: SOURCE,
    code: String(moodleCourse.shortname ?? moodleCourse.id ?? ''),
    title: stripHtml(moodleCourse.fullname) || stripHtml(moodleCourse.shortname) || `Moodle course ${moodleCourse.id}`,
    department: null,
    level: null,
    credit: null,
    instructors: [],
    latestSemester: null,
    description: summary.length > 0 ? summary : null,
    url: getCourseUrl(baseUrl, moodleCourse),
    topics: [],
    resources: courseContents.resources,
    metadata: {
      details: {
        syllabus: courseContents.syllabus,
      },
      moodle: {
        id: moodleCourse.id,
        categoryId: moodleCourse.categoryid ?? null,
        visible: moodleCourse.visible ?? null,
        startDate: moodleTimestampToIso(moodleCourse.startdate) ?? null,
        endDate: moodleTimestampToIso(moodleCourse.enddate) ?? null,
      },
    },
    state: 'enrolled',
    createdAt: syncedAt,
    updatedAt: syncedAt,
  }
}

function mapScrapedCourse(baseUrl, scrapedCourse, html, syncedAt) {
  const title = extractPageTitle(html) || scrapedCourse.title
  const resources = extractResourcesFromCourseHtml(html, baseUrl)

  return {
    id: `moodle-${scrapedCourse.id}`,
    university: 'Kiel University',
    domain: 'Informatics',
    category: 'course',
    language: null,
    source: SOURCE,
    code: String(scrapedCourse.id),
    title,
    department: null,
    level: null,
    credit: null,
    instructors: [],
    latestSemester: null,
    description: null,
    url: scrapedCourse.url,
    topics: [],
    resources,
    metadata: {
      details: {
        syllabus: {
          modules: [
            {
              id: `moodle-${scrapedCourse.id}-html`,
              title: 'Moodle course page',
              startAt: null,
              endAt: null,
              chapters: resources.map(resource => resource.label),
              tasks: [],
            },
          ],
        },
      },
      moodle: {
        id: scrapedCourse.id,
        source: 'html',
      },
    },
    state: 'enrolled',
    createdAt: syncedAt,
    updatedAt: syncedAt,
  }
}

function mapTaskSessions(course, syncedAt) {
  const sessions = []
  for (const module of asArray(course.metadata?.details?.syllabus?.modules)) {
    for (const task of asArray(module.tasks)) {
      if (!task.dueAt) {
        continue
      }

      const start = new Date(task.dueAt)
      if (Number.isNaN(start.getTime())) {
        continue
      }

      const end = new Date(start.getTime() + 60 * 60 * 1000)
      sessions.push({
        id: `${task.id}-due`,
        scheduleId: null,
        entityType: 'course',
        entityId: course.id,
        title: task.title,
        allDay: false,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        timezone: DEFAULT_TIMEZONE,
        location: null,
        category: classifySessionCategory(task.type),
        status: 'scheduled',
        notes: `Moodle deadline for ${course.title}.`,
        metadata: {
          source: SOURCE,
          taskId: task.id,
          moduleId: module.id,
        },
        createdAt: syncedAt,
        updatedAt: syncedAt,
      })
    }
  }

  return sessions
}

async function fetchMoodleHtml(context, url) {
  const response = await context.fetch({
    url,
    method: 'GET',
  })

  if (response.status !== 200) {
    throw new Error(`Moodle page returned HTTP ${response.status}: ${url}`)
  }

  if (response.finalUrl.includes('/login/index.php')) {
    throw new Error('Moodle redirected to login. Please authenticate again.')
  }

  return response.bodyText
}

async function pullMoodleHtml(context, baseUrl, warnings) {
  const syncedAt = nowIso()
  const courseCandidates = []
  const courseListWarnings = []

  for (const path of ['/my/courses.php', '/my/']) {
    try {
      const html = await fetchMoodleHtml(context, `${baseUrl}${path}`)
      courseCandidates.push(...extractCourseLinks(html, baseUrl))
    } catch (error) {
      courseListWarnings.push(`Could not read Moodle course list ${path}: ${error.message}`)
    }
  }

  const uniqueCourses = new Map()
  for (const course of courseCandidates) {
    uniqueCourses.set(course.id, course)
  }

  if (uniqueCourses.size === 0) {
    warnings.push(...courseListWarnings)
  }

  const courses = []
  for (const scrapedCourse of uniqueCourses.values()) {
    try {
      const courseHtml = await fetchMoodleHtml(context, scrapedCourse.url)
      courses.push(mapScrapedCourse(baseUrl, scrapedCourse, courseHtml, syncedAt))
    } catch (error) {
      warnings.push(`Skipped Moodle course ${scrapedCourse.title}: ${error.message}`)
    }
  }

  if (courses.length === 0 && warnings.length === 0) {
    warnings.push('No Moodle courses were found in the authenticated course overview.')
  }

  return {
    protocolVersion: 'v1',
    courses,
    sessions: [],
    warnings,
    summary: {
      courses: courses.length,
      schedules: 0,
      sessions: 0,
    },
  }
}

async function pullMoodle(context, config) {
  const baseUrl = normalizeBaseUrl(config.moodleUrl)
  const authMethod
    = config.authMethod === 'browser' || config.authMethod === 'sso'
      ? config.authMethod
      : 'token'
  const token = typeof config.token === 'string' ? config.token.trim() : ''
  const warnings = []

  if (authMethod === 'token' && token.length === 0) {
    return {
      protocolVersion: 'v1',
      courses: [],
      sessions: [],
      warnings: ['Moodle web service token is missing. Configure a token or switch to Browser Login.'],
      summary: { courses: 0, schedules: 0, sessions: 0 },
    }
  }

  if (authMethod === 'browser' || authMethod === 'sso') {
    const loginPath = authMethod === 'sso'
      ? normalizePath(config.ssoLoginPath, '/auth/shibboleth/index.php')
      : '/login/index.php'
    const loginWarning = await ensureBrowserLogin(context, baseUrl, loginPath)
    if (loginWarning) {
      return {
        protocolVersion: 'v1',
        courses: [],
        sessions: [],
        warnings: [loginWarning],
        summary: { courses: 0, schedules: 0, sessions: 0 },
      }
    }

    return pullMoodleHtml(context, baseUrl, warnings)
  }

  const apiConfig = { ...config, token }
  const siteInfo = await fetchMoodleJson(context, baseUrl, apiConfig, 'core_webservice_get_site_info')
  const userId = siteInfo?.userid

  if (typeof userId !== 'number') {
    throw new Error('Moodle did not return a user id for the authenticated account.')
  }

  const moodleCourses = await fetchMoodleJson(
    context,
    baseUrl,
    apiConfig,
    'core_enrol_get_users_courses',
    { userid: userId },
  )

  if (!Array.isArray(moodleCourses)) {
    throw new Error('Moodle did not return a course list.')
  }

  const syncedAt = nowIso()
  const courses = []
  const sessions = []

  for (const moodleCourse of moodleCourses) {
    try {
      const sections = await fetchMoodleJson(
        context,
        baseUrl,
        apiConfig,
        'core_course_get_contents',
        { courseid: moodleCourse.id },
      )
      const course = mapCourse(baseUrl, moodleCourse, sections, syncedAt)
      courses.push(course)
      sessions.push(...mapTaskSessions(course, syncedAt))
    } catch (error) {
      warnings.push(`Skipped Moodle course ${moodleCourse.fullname ?? moodleCourse.id}: ${error.message}`)
    }
  }

  return {
    protocolVersion: 'v1',
    courses,
    sessions,
    warnings,
    summary: {
      courses: courses.length,
      schedules: 0,
      sessions: sessions.length,
    },
  }
}

export default {
  config: [
    {
      key: 'moodleUrl',
      label: 'Moodle Site URL',
      type: 'text',
      defaultValue: DEFAULT_MOODLE_URL,
      placeholder: DEFAULT_MOODLE_URL,
      description: 'The base URL of your Moodle site.',
    },
    {
      key: 'authMethod',
      label: 'Authentication Method',
      type: 'select',
      defaultValue: 'token',
      options: [
        { value: 'token', label: 'Web Service Token' },
        { value: 'browser', label: 'Browser Login (Cookie)' },
        { value: 'sso', label: 'SSO Login (Username/Password)' },
      ],
    },
    {
      key: 'ssoLoginPath',
      label: 'SSO Login Path',
      type: 'text',
      defaultValue: '/login/index.php',
      placeholder: '/login/index.php',
      description: 'Used by SSO Login. Keep the default for Moodle username/password login unless your Moodle uses another SSO path.',
    },
    {
      key: 'token',
      label: 'Web Service Token',
      type: 'password',
      placeholder: 'your-moodle-token',
      description: 'Required if using Token auth. Generate in Moodle under Profile > Security keys.',
    },
  ],

  async pull(context) {
    try {
      const config = (await context.getConfig()) ?? {}
      return await pullMoodle(context, config)
    } catch (error) {
      return {
        protocolVersion: 'v1',
        courses: [],
        sessions: [],
        warnings: [`Failed to sync from Moodle: ${error.message}`],
        summary: { courses: 0, schedules: 0, sessions: 0 },
      }
    }
  },

  async push(_context, payload) {
    return {
      protocolVersion: 'v1',
      summary: {
        courses: payload.courses?.length ?? 0,
        schedules: payload.schedules?.length ?? 0,
        sessions: 0,
      },
      warnings: ['Moodle push is metadata-only. Remote data was not modified.'],
    }
  },
}
