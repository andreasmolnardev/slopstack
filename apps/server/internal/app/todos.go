package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const maxTodoBodySize = 1 << 20

type todo struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Priority    string `json:"priority"`
	Completed   bool   `json:"completed"`
	DueDate     string `json:"due_date"`
	Created     string `json:"created"`
	Updated     string `json:"updated"`
}

type todoWrite struct {
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	Priority    *string `json:"priority,omitempty"`
	Completed   *bool   `json:"completed,omitempty"`
	DueDate     *string `json:"due_date,omitempty"`
}

type todoListInput struct{}
type todoListOutput struct{ Body []todo }
type todoIDInput struct {
	ID string `path:"id"`
}
type todoOutput struct{ Body todo }
type todoCreateInput struct{ Body todoWrite }
type todoUpdateInput struct {
	ID   string `path:"id"`
	Body todoWrite
}
type todoCreatedOutput struct {
	Status int `status:"status"`
	Body   todo
}
type todoDeletedOutput struct {
	Status int `status:"status"`
}

// registerTodoAPI declares the public contract used to export OpenAPI and
// generate the TypeScript client. PocketBase routes below implement it.
func registerTodoAPI(api huma.API) {
	security := []map[string][]string{{"pocketbaseAuth": {}}}
	errors := []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusNotFound}

	huma.Register(api, huma.Operation{
		OperationID: "listTodos", Method: http.MethodGet, Path: "/api/todos",
		Tags: []string{"Todos"}, Summary: "List the current user's todos",
		Security: security, Errors: errors,
	}, func(context.Context, *todoListInput) (*todoListOutput, error) { return nil, nil })
	huma.Register(api, huma.Operation{
		OperationID: "createTodo", Method: http.MethodPost, Path: "/api/todos",
		Tags: []string{"Todos"}, Summary: "Create a todo for the current user",
		Security: security, Errors: errors, DefaultStatus: http.StatusCreated,
	}, func(context.Context, *todoCreateInput) (*todoCreatedOutput, error) { return nil, nil })
	huma.Register(api, huma.Operation{
		OperationID: "getTodo", Method: http.MethodGet, Path: "/api/todos/{id}",
		Tags: []string{"Todos"}, Summary: "Get one of the current user's todos",
		Security: security, Errors: errors,
	}, func(context.Context, *todoIDInput) (*todoOutput, error) { return nil, nil })
	huma.Register(api, huma.Operation{
		OperationID: "updateTodo", Method: http.MethodPatch, Path: "/api/todos/{id}",
		Tags: []string{"Todos"}, Summary: "Update one of the current user's todos",
		Security: security, Errors: errors,
	}, func(context.Context, *todoUpdateInput) (*todoOutput, error) { return nil, nil })
	huma.Register(api, huma.Operation{
		OperationID: "deleteTodo", Method: http.MethodDelete, Path: "/api/todos/{id}",
		Tags: []string{"Todos"}, Summary: "Delete one of the current user's todos",
		Security: security, Errors: []int{http.StatusUnauthorized, http.StatusNotFound}, DefaultStatus: http.StatusNoContent,
	}, func(context.Context, *todoIDInput) (*todoDeletedOutput, error) { return nil, nil })
}

func registerTodoRoutes(e *core.ServeEvent, _ Config) {
	e.Router.GET("/api/todos", listTodosRoute)
	e.Router.POST("/api/todos", createTodoRoute)
	e.Router.GET("/api/todos/{id}", getTodoRoute)
	e.Router.PATCH("/api/todos/{id}", updateTodoRoute)
	e.Router.DELETE("/api/todos/{id}", deleteTodoRoute)
}

func listTodosRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	records, err := event.App.FindRecordsByFilter("todos", "owner = {:owner}", "due_date,created,id", 0, 0, dbx.Params{"owner": user.Id})
	if err != nil {
		return event.InternalServerError("could not list todos", err)
	}
	response := make([]todo, 0, len(records))
	for _, record := range records {
		response = append(response, todoFromRecord(record))
	}
	return event.JSON(http.StatusOK, response)
}

func createTodoRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	input, err := decodeTodoWrite(event)
	if err != nil {
		return event.BadRequestError("invalid todo body", err)
	}
	if input.Title == nil {
		return event.BadRequestError("title is required", nil)
	}
	collection, err := event.App.FindCollectionByNameOrId("todos")
	if err != nil {
		return event.InternalServerError("todo collection is unavailable", err)
	}
	record := core.NewRecord(collection)
	record.Set("owner", user.Id)
	record.Set("completed", false)
	record.Set("priority", "Medium")
	if err := applyTodoWrite(record, input, true); err != nil {
		return event.BadRequestError(err.Error(), nil)
	}
	if err := event.App.Save(record); err != nil {
		return event.InternalServerError("could not create todo", err)
	}
	return event.JSON(http.StatusCreated, todoFromRecord(record))
}

func getTodoRoute(event *core.RequestEvent) error {
	record, err := findOwnedTodo(event)
	if err != nil {
		return err
	}
	return event.JSON(http.StatusOK, todoFromRecord(record))
}

func updateTodoRoute(event *core.RequestEvent) error {
	record, err := findOwnedTodo(event)
	if err != nil {
		return err
	}
	input, err := decodeTodoWrite(event)
	if err != nil {
		return event.BadRequestError("invalid todo body", err)
	}
	if input.Title == nil && input.Description == nil && input.Priority == nil && input.Completed == nil && input.DueDate == nil {
		return event.BadRequestError("provide at least one todo field to update", nil)
	}
	if err := applyTodoWrite(record, input, false); err != nil {
		return event.BadRequestError(err.Error(), nil)
	}
	if err := event.App.Save(record); err != nil {
		return event.InternalServerError("could not update todo", err)
	}
	return event.JSON(http.StatusOK, todoFromRecord(record))
}

func deleteTodoRoute(event *core.RequestEvent) error {
	record, err := findOwnedTodo(event)
	if err != nil {
		return err
	}
	if err := event.App.Delete(record); err != nil {
		return event.InternalServerError("could not delete todo", err)
	}
	return event.NoContent(http.StatusNoContent)
}

func findOwnedTodo(event *core.RequestEvent) (*core.Record, error) {
	user, err := CurrentUser(event)
	if err != nil {
		return nil, err
	}
	records, err := event.App.FindRecordsByFilter("todos", "id = {:id} && owner = {:owner}", "", 1, 0, dbx.Params{
		"id": event.Request.PathValue("id"), "owner": user.Id,
	})
	if err != nil {
		return nil, event.InternalServerError("could not find todo", err)
	}
	if len(records) == 0 {
		return nil, event.NotFoundError("todo not found", nil)
	}
	return records[0], nil
}

func decodeTodoWrite(event *core.RequestEvent) (todoWrite, error) {
	var input todoWrite
	decoder := json.NewDecoder(io.LimitReader(event.Request.Body, maxTodoBodySize))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return input, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return input, fmt.Errorf("request body must contain one JSON value")
		}
		return input, err
	}
	return input, nil
}

func applyTodoWrite(record *core.Record, input todoWrite, creating bool) error {
	if input.Title != nil {
		title := strings.TrimSpace(*input.Title)
		if title == "" || utf8.RuneCountInString(title) > 200 {
			return fmt.Errorf("title must contain between 1 and 200 characters")
		}
		record.Set("title", title)
	} else if creating {
		return fmt.Errorf("title is required")
	}
	if input.Description != nil {
		if utf8.RuneCountInString(*input.Description) > 5000 {
			return fmt.Errorf("description must be at most 5000 characters")
		}
		record.Set("description", strings.TrimSpace(*input.Description))
	}
	if input.Priority != nil {
		priority := strings.TrimSpace(*input.Priority)
		if priority != "High" && priority != "Medium" && priority != "Low" {
			return fmt.Errorf("priority must be High, Medium, or Low")
		}
		record.Set("priority", priority)
	}
	if input.Completed != nil {
		record.Set("completed", *input.Completed)
	}
	if input.DueDate != nil {
		dueDate := strings.TrimSpace(*input.DueDate)
		if dueDate != "" {
			parsed, err := time.Parse(time.DateOnly, dueDate)
			if err != nil || parsed.Format(time.DateOnly) != dueDate {
				return fmt.Errorf("due_date must use YYYY-MM-DD")
			}
		}
		record.Set("due_date", dueDate)
	}
	return nil
}

func todoFromRecord(record *core.Record) todo {
	priority := record.GetString("priority")
	if priority == "" {
		priority = "Medium"
	}
	return todo{
		ID: record.Id, Title: record.GetString("title"),
		Description: record.GetString("description"), Priority: priority,
		Completed: record.GetBool("completed"), DueDate: record.GetString("due_date"),
		Created: record.GetString("created"), Updated: record.GetString("updated"),
	}
}
