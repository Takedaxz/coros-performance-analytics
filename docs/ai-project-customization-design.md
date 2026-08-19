# AI Coach Project Customization

## Scope

AI Coach projects support a custom name, an activity icon from the existing
sport catalog, and a curated highlight color. The project sidebar exposes one
Edit action and keeps Delete separate.

## Persistence

`chat_projects` stores nullable `icon` and `highlight_color` values. Null
values preserve the folder icon and existing styling for projects created
before customization was introduced. An Alembic migration adds both columns.

## API

`GET`, `POST`, and `PUT /api/ai/projects` responses include `icon` and
`highlight_color`. The update endpoint accepts a project name plus optional
icon and color values. The API validates names, icon keys, and preset colors
before committing the change.

## UI

The project menu contains New Chat, Edit, and Delete. Edit opens a native
dialog with a name input, all existing activity icon options, preset color
swatches, and Cancel/Save actions. A successful save updates the sidebar from
the API response; failures remain visible in the dialog.

## Decisions

- Extend `chat_projects` instead of adding a settings table or JSON column.
- Keep customization fields nullable for existing-project compatibility.
- Reuse the shared activity icon catalog and renderer.
- Apply highlight color to the project header and icon only.
- Retitle validation and name uniqueness remain unchanged.
