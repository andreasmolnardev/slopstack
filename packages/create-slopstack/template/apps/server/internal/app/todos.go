package app

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type Todo struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Completed bool   `json:"completed"`
	DueDate   string `json:"due_date,omitempty"`
	Created   string `json:"created"`
	Updated   string `json:"updated"`
}

type TodoListOutput struct {
	Body []Todo
}

type TodoOutput struct {
	Body Todo
}

type TodoDeleteOutput struct{}

type TodoIDInput struct {
	ID string `path:"id"`
}

type TodoCreateInput struct {
	Body struct {
		Title     string `json:"title" minLength:"1" maxLength:"500"`
		Completed bool   `json:"completed,omitempty"`
		DueDate   string `json:"due_date,omitempty" format:"date"`
	}
}

type TodoUpdateInput struct {
	ID   string `path:"id"`
	Body struct {
		Title     *string `json:"title,omitempty" minLength:"1" maxLength:"500"`
		Completed *bool   `json:"completed,omitempty"`
		DueDate   *string `json:"due_date,omitempty" format:"date"`
	}
}

func registerTodoAPI(api huma.API) {
	security := []map[string][]string{{"pocketbaseAuth": {}}}

	huma.Register(api, huma.Operation{
		OperationID: "listTodos", Method: "GET", Path: "/api/todos", Tags: []string{"Todos"},
		Summary: "List the current user's todos", Security: security,
	}, listTodos)
	huma.Register(api, huma.Operation{
		OperationID: "createTodo", Method: "POST", Path: "/api/todos", Tags: []string{"Todos"},
		Summary: "Create a todo for the current user", Security: security, DefaultStatus: http.StatusCreated,
	}, createTodo)
	huma.Register(api, huma.Operation{
		OperationID: "getTodo", Method: "GET", Path: "/api/todos/{id}", Tags: []string{"Todos"},
		Summary: "Get one of the current user's todos", Security: security,
	}, getTodo)
	huma.Register(api, huma.Operation{
		OperationID: "updateTodo", Method: "PATCH", Path: "/api/todos/{id}", Tags: []string{"Todos"},
		Summary: "Update one of the current user's todos", Security: security,
	}, updateTodo)
	huma.Register(api, huma.Operation{
		OperationID: "deleteTodo", Method: "DELETE", Path: "/api/todos/{id}", Tags: []string{"Todos"},
		Summary: "Delete one of the current user's todos", Security: security, DefaultStatus: http.StatusNoContent,
	}, deleteTodo)
}

func listTodos(ctx context.Context, _ *struct{}) (*TodoListOutput, error) {
	event, err := authenticatedEvent(ctx)
	if err != nil {
		return nil, err
	}
	records, err := event.App.FindRecordsByFilter("todos", "owner = {:owner}", "", 0, 0, dbx.Params{"owner": event.Auth.Id})
	if err != nil {
		return nil, huma.Error500InternalServerError("Could not load todos", err)
	}
	todos := make([]Todo, 0, len(records))
	for _, record := range records {
		todos = append(todos, todoFromRecord(record))
	}
	return &TodoListOutput{Body: todos}, nil
}

func createTodo(ctx context.Context, input *TodoCreateInput) (*TodoOutput, error) {
	event, err := authenticatedEvent(ctx)
	if err != nil {
		return nil, err
	}
	title := strings.TrimSpace(input.Body.Title)
	if title == "" {
		return nil, huma.Error400BadRequest("title is required")
	}
	collection, err := event.App.FindCollectionByNameOrId("todos")
	if err != nil {
		return nil, huma.Error500InternalServerError("Todo collection is unavailable", err)
	}
	record := core.NewRecord(collection)
	record.Set("owner", event.Auth.Id)
	record.Set("title", title)
	record.Set("completed", input.Body.Completed)
	if input.Body.DueDate != "" {
		record.Set("due_date", input.Body.DueDate)
	}
	if err := event.App.Save(record); err != nil {
		return nil, huma.Error400BadRequest("Todo could not be saved", err)
	}
	return &TodoOutput{Body: todoFromRecord(record)}, nil
}

func getTodo(ctx context.Context, input *TodoIDInput) (*TodoOutput, error) {
	event, err := authenticatedEvent(ctx)
	if err != nil {
		return nil, err
	}
	record, err := findOwnedTodo(event, input.ID)
	if err != nil {
		return nil, err
	}
	return &TodoOutput{Body: todoFromRecord(record)}, nil
}

func updateTodo(ctx context.Context, input *TodoUpdateInput) (*TodoOutput, error) {
	event, err := authenticatedEvent(ctx)
	if err != nil {
		return nil, err
	}
	record, err := findOwnedTodo(event, input.ID)
	if err != nil {
		return nil, err
	}
	if input.Body.Title == nil && input.Body.Completed == nil && input.Body.DueDate == nil {
		return nil, huma.Error400BadRequest("provide at least one field to update")
	}
	if input.Body.Title != nil {
		title := strings.TrimSpace(*input.Body.Title)
		if title == "" {
			return nil, huma.Error400BadRequest("title cannot be empty")
		}
		record.Set("title", title)
	}
	if input.Body.Completed != nil {
		record.Set("completed", *input.Body.Completed)
	}
	if input.Body.DueDate != nil {
		record.Set("due_date", *input.Body.DueDate)
	}
	if err := event.App.Save(record); err != nil {
		return nil, huma.Error400BadRequest("Todo could not be saved", err)
	}
	return &TodoOutput{Body: todoFromRecord(record)}, nil
}

func deleteTodo(ctx context.Context, input *TodoIDInput) (*TodoDeleteOutput, error) {
	event, err := authenticatedEvent(ctx)
	if err != nil {
		return nil, err
	}
	record, err := findOwnedTodo(event, input.ID)
	if err != nil {
		return nil, err
	}
	if err := event.App.Delete(record); err != nil {
		return nil, huma.Error500InternalServerError("Todo could not be deleted", err)
	}
	return &TodoDeleteOutput{}, nil
}

func authenticatedEvent(ctx context.Context) (*core.RequestEvent, error) {
	event := requestEvent(ctx)
	if event == nil || event.App == nil || event.Auth == nil {
		return nil, huma.Error401Unauthorized("authentication required")
	}
	return event, nil
}

func findOwnedTodo(event *core.RequestEvent, id string) (*core.Record, error) {
	record, err := event.App.FindRecordById("todos", id)
	if err != nil || record.GetString("owner") != event.Auth.Id {
		return nil, huma.Error404NotFound("Todo not found")
	}
	return record, nil
}

func todoFromRecord(record *core.Record) Todo {
	return Todo{
		ID: record.Id, Title: record.GetString("title"),
		Completed: record.GetBool("completed"), DueDate: record.GetString("due_date"),
		Created: record.GetString("created"), Updated: record.GetString("updated"),
	}
}
